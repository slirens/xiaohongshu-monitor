param(
    [string]$Node = "node.exe",
    [string]$NpmCli,
    [string]$NpmCache,
    [switch]$Offline
)

$ErrorActionPreference = "Stop"
$source = $PSScriptRoot
$runtime = Join-Path $source "runtime"
$nodePath = (Get-Command $Node -ErrorAction Stop).Source
$compiler = Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (!(Test-Path -LiteralPath $compiler)) { throw "需要 Windows x64 的 .NET Framework 4.x C# 编译器。" }
New-Item -ItemType Directory -Path $runtime -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $source "package.json"), (Join-Path $source "package-lock.json") -Destination $runtime -Force
$npmArgs = @("ci", "--prefix", $runtime, "--ignore-scripts", "--omit=dev", "--no-audit", "--no-fund")
if ($NpmCache) { $npmArgs += @("--cache", $NpmCache) }
if ($Offline) { $npmArgs += "--offline" }
if ($NpmCli) { & $nodePath $NpmCli @npmArgs } else { & npm.cmd @npmArgs }
if ($LASTEXITCODE -ne 0) { throw "npm ci failed: $LASTEXITCODE" }
Copy-Item -LiteralPath $nodePath -Destination (Join-Path $runtime "node.exe") -Force
$nodeLicense = Join-Path (Split-Path $nodePath) "LICENSE"
if (Test-Path -LiteralPath $nodeLicense) {
    Copy-Item -LiteralPath $nodeLicense -Destination (Join-Path $runtime "Node-LICENSE.txt") -Force
}
$exe = Join-Path $source "小红书舆情监控v1.exe"
$worker = Join-Path $source "monitor.mjs"
$cover = Join-Path $source "cover.png"
$compilerArgs = @("/nologo", "/target:winexe", "/platform:x64", "/codepage:65001", "/out:$exe",
    "/r:System.Windows.Forms.dll", "/r:System.Drawing.dll", "/r:System.Web.Extensions.dll",
    "/resource:$worker,monitor.mjs", "/resource:$cover,cover.png",
    (Join-Path $source "Desktop.cs"), (Join-Path $source "DesktopActivity.cs"))
& $compiler @compilerArgs
if ($LASTEXITCODE -ne 0) { throw "C# compilation failed: $LASTEXITCODE" }
Get-Item -LiteralPath $exe
