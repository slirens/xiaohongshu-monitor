param(
    [Parameter(Mandatory)]
    [ValidateSet('x86', 'x64')]
    [string]$Architecture,
    [Parameter(Mandatory)]
    [string]$Stage,
    [Parameter(Mandatory)]
    [string]$Evidence
)

$ErrorActionPreference = 'Stop'
$stagePath = (Resolve-Path -LiteralPath $Stage).Path
$proof = (New-Item -ItemType Directory -Path $Evidence -Force).FullName
$target = if ($Architecture -eq 'x86') { 'i686-pc-windows-msvc' } else { 'x86_64-pc-windows-msvc' }
$machine = if ($Architecture -eq 'x86') { 0x014c } else { 0x8664 }
$override = Join-Path $stagePath 'windows-probe.json'
[IO.File]::WriteAllText($override, '{"productName":"XHS Tauri Windows Probe","identifier":"local.xhs.tauri.windowsprobe","bundle":{"windows":{"nsis":{"installMode":"currentUser"}}}}')

function Read-PEMachine([string]$Path) {
    $stream = [IO.File]::OpenRead($Path)
    try {
        $reader = [IO.BinaryReader]::new($stream)
        if ($reader.ReadUInt16() -ne 0x5a4d) { throw 'Missing DOS header.' }
        $stream.Position = 0x3c
        $stream.Position = $reader.ReadUInt32()
        if ($reader.ReadUInt32() -ne 0x4550) { throw 'Missing PE header.' }
        return $reader.ReadUInt16()
    } finally {
        $stream.Dispose()
    }
}

rustup target add $target
if ($LASTEXITCODE -ne 0) { throw "Could not install Rust target $target." }
Push-Location -LiteralPath (Join-Path $stagePath 'src-tauri')
try {
    cargo generate-lockfile
    if ($LASTEXITCODE -ne 0) { throw 'Could not resolve the probe dependencies.' }
    npx.cmd --yes --package '@tauri-apps/cli@2.12.6' tauri build --debug --ci --target $target --bundles nsis --config $override -- --locked
    if ($LASTEXITCODE -ne 0) { throw "Tauri NSIS build failed for $target." }
    $bundle = Join-Path $PWD.Path "target/$target/debug/bundle/nsis"
    $installers = @(Get-ChildItem -LiteralPath $bundle -Filter '*setup.exe' -File)
    if ($installers.Count -ne 1) { throw 'Expected one generated Tauri NSIS installer.' }
    $setup = $installers[0].FullName
} finally {
    Pop-Location
}

$installation = Join-Path $stagePath 'installed-probe'
$setupProcess = Start-Process -FilePath $setup -ArgumentList @('/S', "/D=$installation") -WindowStyle Hidden -PassThru
if (!$setupProcess.WaitForExit(120000)) { $setupProcess.Kill(); throw 'Probe installer timed out.' }
if ($setupProcess.ExitCode -ne 0) { throw "Probe installer exited with $($setupProcess.ExitCode)." }
$applications = @(Get-ChildItem -LiteralPath $installation -Filter '*.exe' -File |
    Where-Object { $_.Name -notmatch '^(uninstall|unins|WebView2)' })
if ($applications.Count -ne 1) { throw 'Expected one installed probe application.' }
$application = $applications[0].FullName
if ((Read-PEMachine $application) -ne $machine) { throw "Installed application is not $Architecture." }

$stdout = Join-Path $proof 'webview.log'
$stderr = Join-Path $proof 'webview-errors.log'
$probe = Start-Process -FilePath $application -WorkingDirectory $installation -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
try {
    $deadline = [DateTime]::UtcNow.AddSeconds(45)
    do {
        $output = Get-Content -Raw -LiteralPath $stdout -ErrorAction SilentlyContinue
        if ($output -match 'WEBVIEW_READY main' -or $probe.HasExited) { break }
        Start-Sleep -Milliseconds 500
    } while ([DateTime]::UtcNow -lt $deadline)
} finally {
    if (!$probe.HasExited) {
        $null = $probe.CloseMainWindow()
        if (!$probe.WaitForExit(3000)) { $probe.Kill() }
    }
}
if ($output -notmatch 'WEBVIEW_READY main' -or $output -notmatch 'shared-f' -or $output -match 'WEBVIEW_FAILED') {
    Get-Content -LiteralPath $stderr -ErrorAction SilentlyContinue
    throw 'The installed Tauri application did not return the F interaction test result.'
}
$output
Get-FileHash -LiteralPath $setup | Select-Object Hash, @{Name='Package';Expression={$installers[0].Name}} |
    ConvertTo-Json | Set-Content -LiteralPath (Join-Path $proof 'installer-sha256.json') -Encoding utf8
Write-Output "Verified Windows $Architecture installation, installed PE architecture and WebView2 fixture interactions."
