[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$Stage,
    [Parameter(Mandatory)]
    [string]$Evidence,
    [Parameter(Mandatory)]
    [ValidateSet('x86', 'x64')]
    [string]$Architecture,
    [string]$Artifacts
)

$ErrorActionPreference = 'Stop'
$productName = 'XHS Monitor F Preview'
$bundleId = 'com.xhsmonitor.preview'
$version = '1.0.9'
$target = if ($Architecture -eq 'x86') { 'i686-pc-windows-msvc' } else { 'x86_64-pc-windows-msvc' }
$machine = if ($Architecture -eq 'x86') { 0x014c } else { 0x8664 }
$stagePath = (Resolve-Path -LiteralPath $Stage).Path
$source = Join-Path $stagePath 'src-tauri'
$config = Get-Content -Raw -LiteralPath (Join-Path $source 'tauri.conf.json') | ConvertFrom-Json
if ($config.identifier -cne $bundleId -or $config.productName -cne $productName -or
    $config.version -cne $version -or $config.bundle.windows.nsis.installMode -cne 'currentUser') {
    throw 'The stage must be the isolated 1.0.9 F preview configured for current-user NSIS installation.'
}
$proof = (New-Item -ItemType Directory -Path $Evidence -Force).FullName
if (!$Artifacts) { $Artifacts = Join-Path $proof 'packages' }
$artifactPath = (New-Item -ItemType Directory -Path $Artifacts -Force).FullName
$packageName = "xiaohongshu-monitor-v1.0.9-preview.1-windows-$Architecture-setup.exe"
$output = Join-Path $artifactPath $packageName

function Read-PeMachine([string]$Path) {
    $stream = [IO.File]::OpenRead($Path)
    try {
        $reader = [IO.BinaryReader]::new($stream)
        if ($stream.Length -lt 70 -or $reader.ReadUInt16() -ne 0x5a4d) {
            throw "Missing DOS executable header: $Path"
        }
        $stream.Position = 0x3c
        [uint32]$header = $reader.ReadUInt32()
        if ($header -lt 0x40 -or $header -gt ($stream.Length - 6)) {
            throw "Invalid PE header offset: $Path"
        }
        $stream.Position = $header
        if ($reader.ReadUInt32() -ne 0x00004550) { throw "Missing PE header: $Path" }
        return $reader.ReadUInt16()
    } finally {
        $stream.Dispose()
    }
}

function Test-NsisHeader([string]$Path) {
    $encoding = [Text.Encoding]::GetEncoding(28591)
    $signature = $encoding.GetString([byte[]]@(0xef, 0xbe, 0xad, 0xde)) + 'NullsoftInst'
    $stream = [IO.File]::OpenRead($Path)
    try {
        $buffer = [byte[]]::new(65536)
        $overlap = ''
        while (($read = $stream.Read($buffer, 0, $buffer.Length)) -ne 0) {
            $contents = $overlap + $encoding.GetString($buffer, 0, $read)
            if ($contents.IndexOf($signature, [StringComparison]::Ordinal) -ge 0) { return $true }
            $keep = [Math]::Min($contents.Length, $signature.Length - 1)
            $overlap = $contents.Substring($contents.Length - $keep)
        }
        return $false
    } finally {
        $stream.Dispose()
    }
}

function Wait-ForInstaller([string]$Executable, [string]$Arguments, [string]$Description) {
    $process = Start-Process -FilePath $Executable -ArgumentList $Arguments -WindowStyle Hidden -PassThru
    try {
        if (!$process.WaitForExit(120000)) {
            if (!$process.HasExited) { $process.Kill(); $null = $process.WaitForExit(5000) }
            throw "$Description timed out."
        }
        if ($process.ExitCode -ne 0) { throw "$Description exited with $($process.ExitCode)." }
    } finally {
        $process.Dispose()
    }
}

function Read-ProcessOutput([string]$Path) {
    try { return [string](Get-Content -Raw -LiteralPath $Path -ErrorAction Stop) }
    catch [IO.IOException] { return '' }
    catch [System.Management.Automation.ItemNotFoundException] { return '' }
}

function Invoke-InstalledPreview([string]$ApplicationPath, [string]$WorkingDirectory, [bool]$Verify) {
    $mode = if ($Verify) { 'verify' } else { 'interactive' }
    $stdout = Join-Path $proof "$mode.log"
    $stderr = Join-Path $proof "$mode-errors.log"
    $start = @{
        FilePath = $ApplicationPath
        WorkingDirectory = $WorkingDirectory
        RedirectStandardOutput = $stdout
        RedirectStandardError = $stderr
        PassThru = $true
    }
    $expected = if ($Verify) { '(?m)^WEBVIEW_READY main (\{[^\r\n]+\})\s*$' } else { '(?m)^PREVIEW_READY main\s*$' }
    if ($Verify) { $start.ArgumentList = @('--verify-preview') }
    $process = Start-Process @start
    $completion = $null
    $title = ''
    $cleanup = 'exited'
    try {
        $deadline = [DateTime]::UtcNow.AddSeconds(55)
        do {
            $observed = Read-ProcessOutput $stdout
            $reportedErrors = Read-ProcessOutput $stderr
            $completion = [regex]::Match($observed, $expected)
            if ($completion.Success -or $process.HasExited -or $reportedErrors -match '(?m)^WEBVIEW_FAILED\b') { break }
            Start-Sleep -Milliseconds 220
        } while ([DateTime]::UtcNow -lt $deadline)
        if (!$completion.Success -or $reportedErrors -match '(?m)^WEBVIEW_FAILED\b') {
            if ($reportedErrors) { Write-Host $reportedErrors }
            throw "The installed F preview did not report the expected $mode result. See $stdout."
        }
        if ($Verify) {
            $result = $completion.Groups[1].Value | ConvertFrom-Json
            if ($result.fixture -cne 'shared-f') { throw 'Verification must exercise the shared F sample.' }
        } else {
            Start-Sleep -Milliseconds 2000
            $observed = Read-ProcessOutput $stdout
            $reportedErrors = Read-ProcessOutput $stderr
            if ($observed -match '(?m)^WEBVIEW_READY\b' -or $reportedErrors -match '(?m)^WEBVIEW_FAILED\b' -or $process.HasExited) {
                throw 'Ordinary launch ran the verification probe or ended instead of staying open.'
            }
        }
        $process.Refresh()
        if (!$process.HasExited) { $title = $process.MainWindowTitle }
        elseif ($process.ExitCode -ne 0) { throw "Installed preview exited with $($process.ExitCode)." }
    } finally {
        try {
            if (!$process.HasExited) {
                $cleanup = 'closed-window'
                $null = $process.CloseMainWindow()
                if (!$process.WaitForExit(4000)) {
                    $cleanup = 'terminated-by-harness'
                    if (!$process.HasExited) { $process.Kill() }
                    if (!$process.WaitForExit(5000)) { throw "The $mode preview process did not stop." }
                }
            }
        } finally {
            $process.Dispose()
        }
    }
    [pscustomobject]@{ mode = $mode; marker = $completion.Value.Trim(); windowTitle = $title; cleanup = $cleanup }
}

$uninstallKeys = @(
    'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKCU:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
)
$existing = @(Get-ItemProperty -Path $uninstallKeys -ErrorAction SilentlyContinue |
    Where-Object { $_.DisplayName -ceq $productName -or $_.PSChildName -ceq $bundleId })
if ($existing.Count) { throw 'An F preview is already registered. Use a clean Windows CI runner.' }

rustup target add $target
if ($LASTEXITCODE -ne 0) { throw "Could not install Rust target $target." }
Push-Location -LiteralPath $source
try {
    if (!(Test-Path -LiteralPath 'Cargo.lock' -PathType Leaf)) {
        cargo generate-lockfile
        if ($LASTEXITCODE -ne 0) { throw 'Could not resolve the preview dependencies.' }
    }
    $metadata = cargo metadata --format-version 1 --no-deps --locked
    if ($LASTEXITCODE -ne 0) { throw 'Could not resolve the preview Cargo output directory.' }
    $targetDirectory = ($metadata | ConvertFrom-Json).target_directory
    $builtAt = [DateTime]::UtcNow
    npx.cmd --yes --package '@tauri-apps/cli@2.12.6' tauri build --debug --ci --target $target --bundles nsis -- --locked
    if ($LASTEXITCODE -ne 0) { throw "Tauri preview NSIS build failed for $target." }
    $bundle = Join-Path $targetDirectory "$target/debug/bundle/nsis"
    $installers = @(Get-ChildItem -LiteralPath $bundle -Filter '*setup.exe' -File |
        Where-Object { $_.LastWriteTimeUtc -ge $builtAt.AddSeconds(-2) })
    if ($installers.Count -ne 1) { throw 'Expected exactly one fresh Tauri NSIS installer.' }
    $setup = $installers[0].FullName
} finally {
    Pop-Location
}

$setupMachine = Read-PeMachine $setup
if ($setupMachine -notin @(0x014c, 0x8664) -or !(Test-NsisHeader $setup)) {
    throw 'The generated installer is not a Windows NSIS PE executable.'
}

$installation = Join-Path $stagePath ("installed-preview-$Architecture-" + [Guid]::NewGuid().ToString('N'))
$application = $null
$appMachine = $null
$runs = @()
try {
    # NSIS requires the absolute /D option to be last and unquoted, also with spaces.
    Wait-ForInstaller $setup "/S /D=$installation" 'Preview installer'
    if (!(Test-Path -LiteralPath (Join-Path $installation 'uninstall.exe') -PathType Leaf)) {
        throw 'The preview installer did not register a local uninstaller.'
    }
    $applications = @(Get-ChildItem -LiteralPath $installation -Filter '*.exe' -File |
        Where-Object { $_.Name -notmatch '^(uninstall|unins|WebView2)' })
    if ($applications.Count -ne 1) { throw 'Expected exactly one installed F preview executable.' }
    $application = $applications[0].FullName
    $appMachine = Read-PeMachine $application
    if ($appMachine -ne $machine) { throw "The installed application is not $Architecture." }
    if ($applications[0].VersionInfo.ProductName -cne $productName -or
        $applications[0].VersionInfo.ProductVersion -notmatch '^1\.0\.9(?:\.0)?$') {
        throw 'The installed binary does not identify itself as the 1.0.9 F preview.'
    }
    $runs += Invoke-InstalledPreview $application $installation $false
    $runs += Invoke-InstalledPreview $application $installation $true
} finally {
    $uninstaller = Join-Path $installation 'uninstall.exe'
    if (Test-Path -LiteralPath $uninstaller -PathType Leaf) {
        if (!(Test-NsisHeader $uninstaller)) { throw 'The preview uninstaller does not have a valid NSIS header.' }
        # NSIS _?= keeps the uninstaller in this isolated directory and waits for it.
        Wait-ForInstaller $uninstaller "/S _?=$installation" 'Preview uninstaller'
        if ($application -and (Test-Path -LiteralPath $application -PathType Leaf)) {
            throw 'The preview application is still installed after uninstalling.'
        }
    }
}

$digest = (Get-FileHash -LiteralPath $setup -Algorithm SHA256).Hash.ToLowerInvariant()
if (Test-Path -LiteralPath $output -PathType Leaf) {
    if ((Get-FileHash -LiteralPath $output -Algorithm SHA256).Hash.ToLowerInvariant() -ne $digest) {
        throw "A different installer already exists at $output."
    }
} else {
    [IO.File]::Copy($setup, $output, $false)
}
if ((Get-FileHash -LiteralPath $output -Algorithm SHA256).Hash.ToLowerInvariant() -ne $digest) {
    throw 'The staged installer SHA-256 changed while copying.'
}
[ordered]@{
    package = $packageName
    sha256 = $digest
    architecture = $Architecture
    rustTarget = $target
    installerMachine = ('0x{0:X4}' -f $setupMachine)
    installedMachine = ('0x{0:X4}' -f $appMachine)
    bundleId = $bundleId
    version = $version
    runs = $runs
} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $proof 'installer-sha256.json') -Encoding utf8
Write-Output "Verified Windows $Architecture preview package at $output."
