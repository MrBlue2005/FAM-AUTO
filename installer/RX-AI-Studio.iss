#define MyAppName "RX AI Studio"
#define MyAppVersion "1.1.0"
#define MyAppPublisher "R.X. AI Studio"

[Setup]
AppId={{8E623FC4-4B4E-42D4-9934-E4A8F7635A91}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={localappdata}\Programs\RX AI Studio
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
WizardStyle=modern
Compression=lzma2/ultra64
SolidCompression=yes
SetupIconFile=..\overlay-desktop\build\icon.ico
OutputDir=dist
OutputBaseFilename=RX-AI-Studio-Setup-{#MyAppVersion}
UninstallDisplayIcon={app}\overlay-desktop\launcher\dist\win-unpacked\RX AI Studio Launcher.exe
CloseApplications=no

[Files]
Source: ".staging\app\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Run]
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\installer\install-rx-studio.ps1"" -InstallRoot ""{app}"""; WorkingDir: "{app}"; StatusMsg: "Instalez dependintele RX AI Studio..."; Flags: waituntilterminated

[UninstallRun]
Filename: "{sys}\schtasks.exe"; Parameters: "/Delete /TN ""RX AI Studio Welcome"" /F"; Flags: runhidden skipifdoesntexist; RunOnceId: "RemoveStartupTask"

[UninstallDelete]
Type: files; Name: "{userdesktop}\RX AI Studio.lnk"
Type: filesandordirs; Name: "{app}\runtime\node"
Type: filesandordirs; Name: "{app}\node_modules"
Type: filesandordirs; Name: "{app}\dashboard-v2\node_modules"
Type: filesandordirs; Name: "{app}\dashboard-v2\dist"
Type: filesandordirs; Name: "{app}\property-copywriter\node_modules"
Type: filesandordirs; Name: "{app}\property-copywriter\.next"
Type: filesandordirs; Name: "{app}\overlay-desktop\node_modules"
Type: filesandordirs; Name: "{app}\overlay-desktop\dist"
Type: filesandordirs; Name: "{app}\overlay-desktop\launcher\dist"
