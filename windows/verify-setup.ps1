param(
    [Parameter(Mandatory)]
    [string]$Setup,
    [Parameter(Mandatory)]
    [ValidateSet('x64', 'x86')]
    [string]$Architecture,
    [Parameter(Mandatory)]
    [ValidatePattern('^[0-9]+\.[0-9]+\.[0-9]+$')]
    [string]$Version
)

$ErrorActionPreference = 'Stop'
$setupPath = (Resolve-Path -LiteralPath $Setup).ProviderPath
$directory = New-Item -ItemType Directory -Path (Join-Path $env:RUNNER_TEMP ('verify-xhs-setup-' + [guid]::NewGuid().ToString('N')))
$appFolder = Join-Path $directory.FullName 'installed'
$exe = Join-Path $appFolder '小红书舆情监控v1.exe'
$node = Join-Path $appFolder 'runtime/node.exe'
$uninstaller = Join-Path $appFolder 'unins000.exe'
$shortcut = Join-Path ([Environment]::GetFolderPath('Programs')) '小红书舆情监控.lnk'
$fixture = Join-Path $directory.FullName 'notes.json'
Set-Content -LiteralPath $fixture -Encoding utf8NoBOM -Value '[{"title":"之禾 咖啡","body":"用于安装后验证的笔记","date":"2026-11-21","url":"https://www.xiaohongshu.com/explore/0123456789abcdef01234567"}]'
$installArguments = @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/SP-', ('/DIR="{0}"' -f $appFolder))

function Invoke-CheckedProcess($Executable, $Arguments, $Activity) {
    $process = Start-Process -FilePath $Executable -ArgumentList $Arguments -WindowStyle Hidden -PassThru
    if (!$process.WaitForExit(90000)) {
        $process.Kill()
        throw "$Activity timed out."
    }
    if ($process.ExitCode -ne 0) { throw "$Activity failed ($($process.ExitCode))." }
}

Invoke-CheckedProcess $setupPath $installArguments 'Installation'
if (!(Test-Path -LiteralPath $shortcut)) { throw 'No Start menu shortcut was created.' }
$registration = Get-ItemProperty -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\{3D8FB0B8-4391-4BC3-9A19-6CEC6993780F}_is1'
if ($registration.InstallLocation.Trim('"').TrimEnd('\') -ne $appFolder) { throw 'The application was not registered for the current user.' }
if ($registration.DisplayVersion -ne $Version) { throw 'The registered app version is incorrect.' }
if ([Diagnostics.FileVersionInfo]::GetVersionInfo($exe).ProductVersion -ne $Version) { throw 'The installed executable version is incorrect.' }
$expected = if ($Architecture -eq 'x64') { 'x64' } else { 'ia32' }
if ((& $node -p 'process.arch') -ne $expected -or $LASTEXITCODE -ne 0) {
    throw "The installed Node runtime does not match $Architecture."
}
$env:XHS_AI_KEY = $null
$env:OPENAI_API_KEY = $null
Invoke-CheckedProcess $exe @('--verify-ui', 'en') 'English interface smoke test'
Invoke-CheckedProcess $exe @('--verify-ui', 'zh-CN') 'Simplified Chinese interface smoke test'
if ($env:XHS_UI_SCREENSHOTS) {
    $capture = Join-Path $directory.FullName 'capture-f1a.exe'
    $compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
    & $compiler /nologo /target:exe "/platform:$Architecture" /codepage:65001 "/out:$capture" /r:System.Windows.Forms.dll /r:System.Drawing.dll (Join-Path $PSScriptRoot 'CaptureF1A.cs')
    if ($LASTEXITCODE) { throw 'F+1A screenshot fixture compilation failed.' }
    foreach ($locale in @('zh-CN', 'en')) {
        Invoke-CheckedProcess $capture @(('"{0}"' -f $exe), $locale, ('"{0}"' -f $env:XHS_UI_SCREENSHOTS)) "F+1A screenshots ($locale)"
    }
}
Invoke-CheckedProcess $exe @('--verify', ('"{0}"' -f $fixture)) 'Installed desktop smoke test'
$worker = Join-Path $appFolder 'runtime/monitor.mjs'
& $node (Join-Path $PSScriptRoot '../tests/verify-warm-worker.cjs') $worker
if ($LASTEXITCODE -ne 0) { throw 'Installed worker prewarm verification failed.' }
$report = Get-ChildItem -LiteralPath (Join-Path $appFolder 'reports') -Filter '*.xlsx'
if (@($report).Count -ne 1) { throw 'Expected one combined Excel report.' }
if ($report.Name -notmatch '^舆情_\d{6}_[a-f0-9]+\.xlsx$') { throw 'Unexpected report filename.' }
$env:XHS_VERIFY_WORKBOOK = $report.FullName
$env:XHS_VERIFY_EXCELJS = Join-Path $appFolder 'runtime/node_modules/exceljs'
$check = @'
const assert = require('node:assert/strict');
const { Workbook } = require(process.env.XHS_VERIFY_EXCELJS);
(async () => {
    const workbook = new Workbook();
    await workbook.xlsx.readFile(process.env.XHS_VERIFY_WORKBOOK);
    const keywords = ['之禾', '咖啡'];
    assert.deepEqual(workbook.worksheets.filter(sheet => sheet.state === 'visible').map(sheet => sheet.name),
        ['总结', '总表', '2026-11-21', ...keywords]);
    assert.equal(workbook.getWorksheet('_xhs_continuation').state, 'veryHidden');
    for (const keyword of keywords) {
        assert.equal(workbook.getWorksheet(keyword).getCell('B2').value, '之禾 咖啡');
        assert.equal(workbook.getWorksheet(keyword).getCell('D2').hyperlink,
            'https://www.xiaohongshu.com/explore/0123456789abcdef01234567');
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
'@
$checkFile = Join-Path $directory.FullName 'verify-workbook.cjs'
Set-Content -LiteralPath $checkFile -Encoding utf8NoBOM -Value $check
& $node $checkFile
if ($LASTEXITCODE -ne 0) { throw 'Workbook verification failed.' }

# Verify that generated data survives a reinstall and removal of installed files.
$profile = New-Item -ItemType Directory -Path (Join-Path $appFolder '.chrome-session')
$marker = Join-Path $profile.FullName 'user-data-fixture.txt'
Set-Content -LiteralPath $marker -Value 'user-generated profile data'
$hash = (Get-FileHash -LiteralPath $report.FullName).Hash
Invoke-CheckedProcess $setupPath $installArguments 'Reinstallation'
Invoke-CheckedProcess $uninstaller @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART') 'Uninstallation'
for ($attempt = 0; $attempt -lt 30 -and ((Test-Path -LiteralPath $exe) -or (Test-Path -LiteralPath $shortcut)); $attempt++) {
    Start-Sleep -Milliseconds 250
}
if ((Test-Path -LiteralPath $exe) -or (Test-Path -LiteralPath $shortcut)) {
    throw 'Setup did not remove its application and shortcut.'
}
if (!(Test-Path -LiteralPath $marker) -or !(Test-Path -LiteralPath $report.FullName) -or
    (Get-FileHash -LiteralPath $report.FullName).Hash -ne $hash) {
    throw 'An existing browser profile or exported report was not preserved.'
}
"Verified $Architecture per-user setup, installed desktop, workbook, reinstall and uninstall."
