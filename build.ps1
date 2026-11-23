param(
    [string]$Node = "node.exe",
    [string]$NpmCli,
    [string]$NpmCache,
    [switch]$Offline,
    [ValidateSet("x64", "x86")]
    [string]$Architecture = "x64",
    [string]$OutputDirectory
)

$ErrorActionPreference = "Stop"
$source = $PSScriptRoot
$nodePath = (Get-Command $Node -CommandType Application -ErrorAction Stop).Source
$expectedNodeArchitecture = if ($Architecture -eq "x86") { "ia32" } else { "x64" }
$nodeArchitecture = & $nodePath -p "process.arch"
if ($LASTEXITCODE -ne 0 -or $nodeArchitecture -ne $expectedNodeArchitecture) {
    throw "请为 $Architecture 构建提供对应架构的 Node.js。"
}
$framework = if ($Architecture -eq "x86") { "Framework" } else { "Framework64" }
$compiler = Join-Path $env:WINDIR "Microsoft.NET\$framework\v4.0.30319\csc.exe"
if (!(Test-Path -LiteralPath $compiler)) { throw "需要 .NET Framework 4.x 的 $Architecture C# 编译器。" }
if (!$OutputDirectory) {
    $OutputDirectory = if ($Architecture -eq "x86") { Join-Path $source "dist\windows-x86" } else { $source }
}
$destination = (New-Item -ItemType Directory -Path $OutputDirectory -Force).FullName
$runtime = Join-Path $destination "runtime"
New-Item -ItemType Directory -Path $runtime -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $source "package.json"), (Join-Path $source "package-lock.json") -Destination $runtime -Force
$npmArgs = @("ci", "--prefix", $runtime, "--ignore-scripts", "--omit=dev", "--no-audit", "--no-fund")
if ($NpmCache) { $npmArgs += @("--cache", $NpmCache) }
if ($Offline) { $npmArgs += "--offline" }
$nodeDirectory = Split-Path -LiteralPath $nodePath
if (!$NpmCli) {
    $bundledNpm = Join-Path $nodeDirectory "node_modules\npm\bin\npm-cli.js"
    if (Test-Path -LiteralPath $bundledNpm) { $NpmCli = $bundledNpm }
}
if ($NpmCli) { & $nodePath $NpmCli @npmArgs } else { & npm.cmd @npmArgs }
if ($LASTEXITCODE -ne 0) { throw "npm ci failed: $LASTEXITCODE" }
Copy-Item -LiteralPath $nodePath -Destination (Join-Path $runtime "node.exe") -Force
Copy-Item -LiteralPath (Join-Path $source "report-template.mjs") -Destination $runtime -Force
$nodeLicense = Join-Path $nodeDirectory "LICENSE"
if (Test-Path -LiteralPath $nodeLicense) {
    Copy-Item -LiteralPath $nodeLicense -Destination (Join-Path $runtime "Node-LICENSE.txt") -Force
}
$exe = Join-Path $destination "小红书舆情监控v1.exe"
$worker = Join-Path $source "monitor.mjs"
$cover = Join-Path $source "cover.png"
$compilerArgs = @("/nologo", "/target:winexe", "/platform:$Architecture", "/codepage:65001", "/out:$exe",
    "/r:System.Windows.Forms.dll", "/r:System.Drawing.dll", "/r:System.Web.Extensions.dll",
    "/resource:$worker,monitor.mjs", "/resource:$cover,cover.png",
    (Join-Path $source "Desktop.cs"), (Join-Path $source "DesktopActivity.cs"))
& $compiler @compilerArgs
if ($LASTEXITCODE -ne 0) { throw "C# compilation failed: $LASTEXITCODE" }
if ($destination -ne $source) {
    Copy-Item -LiteralPath (Join-Path $source "LICENSE"), (Join-Path $source "报告生成模板.md") -Destination $destination -Force
}
Get-Item -LiteralPath $exe
