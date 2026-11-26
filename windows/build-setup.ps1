param(
    [Parameter(Mandatory)]
    [ValidateSet('x64', 'x86')]
    [string]$Architecture,
    [Parameter(Mandatory)]
    [ValidatePattern('^[0-9]+\.[0-9]+\.[0-9]+$')]
    [string]$Version,
    [string]$OutputDirectory,
    [string]$Node = 'node.exe',
    [string]$InnoCompiler,
    [string]$NpmCache,
    [switch]$Offline
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -LiteralPath $PSScriptRoot
if (!$OutputDirectory) { $OutputDirectory = Join-Path $repo 'dist/windows-setup' }
$output = (New-Item -ItemType Directory -Path $OutputDirectory -Force).FullName
if (!$InnoCompiler) {
    $InnoCompiler = (Get-Command ISCC.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1).Source
    if (!$InnoCompiler) {
        $programFiles = if (${env:ProgramFiles(x86)}) { ${env:ProgramFiles(x86)} } else { $env:ProgramFiles }
        $InnoCompiler = Join-Path $programFiles 'Inno Setup 6/ISCC.exe'
    }
}
if (!(Test-Path -LiteralPath $InnoCompiler -PathType Leaf)) {
    throw 'Inno Setup 6 is required. Supply the full ISCC.exe path if it is installed elsewhere.'
}

$tempRoot = (Get-Item -LiteralPath ([IO.Path]::GetTempPath())).FullName
$directory = New-Item -ItemType Directory -Path (Join-Path $tempRoot ('xhs-setup-' + [guid]::NewGuid().ToString('N')))
try {
    & (Join-Path $repo 'build.ps1') -Node $Node -Architecture $Architecture -OutputDirectory $directory.FullName -NpmCache $NpmCache -Offline:$Offline
    if (!(Test-Path -LiteralPath (Join-Path $directory.FullName 'runtime/Node-LICENSE.txt'))) {
        throw 'Use the official Node.js distribution with its bundled license.'
    }
    $env:XHS_SETUP_APP_NAME = '小红书舆情监控'
    $env:XHS_SETUP_APP_EXE = $env:XHS_SETUP_APP_NAME + 'v1.exe'
    $env:XHS_SETUP_PAYLOAD = $directory.FullName
    $env:XHS_SETUP_ARCH = $Architecture
    $env:XHS_SETUP_VERSION = $Version
    & $InnoCompiler "/O$output" (Join-Path $PSScriptRoot 'setup.iss')
    if ($LASTEXITCODE -ne 0) { throw "Inno Setup compilation failed ($LASTEXITCODE)." }
    Get-Item -LiteralPath (Join-Path $output "xiaohongshu-monitor-v$Version-windows-$Architecture-setup.exe")
}
finally {
    Remove-Item Env:XHS_SETUP_APP_NAME, Env:XHS_SETUP_APP_EXE, Env:XHS_SETUP_PAYLOAD, Env:XHS_SETUP_ARCH, Env:XHS_SETUP_VERSION -ErrorAction SilentlyContinue
    $resolved = (Resolve-Path -LiteralPath $directory.FullName).ProviderPath
    if ((Split-Path -LiteralPath $resolved) -eq $tempRoot.TrimEnd('\') -and
        (Split-Path -Path $resolved -Leaf) -match '^xhs-setup-[a-f0-9]{32}$') {
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}
