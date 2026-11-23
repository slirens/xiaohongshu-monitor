#define Payload GetEnv("XHS_SETUP_PAYLOAD")
#define BuildArch GetEnv("XHS_SETUP_ARCH")
#define ReleaseVersion GetEnv("XHS_SETUP_VERSION")
#define MonitorName GetEnv("XHS_SETUP_APP_NAME")
#define MonitorExe GetEnv("XHS_SETUP_APP_EXE")

[Setup]
AppId={{3D8FB0B8-4391-4BC3-9A19-6CEC6993780F}
AppName={#MonitorName}
AppVersion={#ReleaseVersion}
VersionInfoVersion={#ReleaseVersion}
VersionInfoProductVersion={#ReleaseVersion}
AppPublisher=slirens
AppPublisherURL=https://github.com/slirens/xiaohongshu-monitor
AppSupportURL=https://github.com/slirens/xiaohongshu-monitor/issues
AppUpdatesURL=https://github.com/slirens/xiaohongshu-monitor/releases
DefaultDirName={localappdata}\Programs\Xiaohongshu Monitor
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
MinVersion=10.0
#if BuildArch == "x64"
ArchitecturesAllowed=x64compatible
#else
ArchitecturesAllowed=x86compatible
#endif
OutputBaseFilename=xiaohongshu-monitor-v{#ReleaseVersion}-windows-{#BuildArch}-setup
LicenseFile={#Payload}\LICENSE
UninstallDisplayIcon={app}\{#MonitorExe}
Compression=lzma2
SolidCompression=yes
RestartApplications=no

[Files]
Source: "{#Payload}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{userprograms}\{#MonitorName}"; Filename: "{app}\{#MonitorExe}"; WorkingDir: "{app}"

[Run]
Filename: "{app}\{#MonitorExe}"; Description: "{cm:LaunchProgram,{#MonitorName}}"; Flags: postinstall nowait skipifsilent
