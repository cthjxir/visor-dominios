; Instalador de Windows generado con Inno Setup (iscc).
; Requiere haber corrido antes: npm run build:backend && npx electron-builder --win dir
; que deja el build listo en dist\win-unpacked\
; La version se puede pasar como /DAppVersion=X.Y.Z (asi lo hace el release
; de GitHub Actions); si se corre iscc directo, usa el valor por defecto.
#ifndef AppVersion
#define AppVersion "1.1.2"
#endif

[Setup]
AppName=Visor Dominios
AppVersion={#AppVersion}
DefaultDirName={autopf}\Visor Dominios
DefaultGroupName=Visor Dominios
OutputDir=..\dist\installer
OutputBaseFilename=visor-dominios-setup
ArchitecturesInstallIn64BitMode=x64
; SetupIconFile=..\build\icon.ico   ; descomentar cuando exista un icono real

[Files]
Source: "..\dist\win-unpacked\*"; DestDir: "{app}"; Flags: recursesubdirs

[Icons]
Name: "{group}\Visor Dominios"; Filename: "{app}\Visor Dominios.exe"
Name: "{commondesktop}\Visor Dominios"; Filename: "{app}\Visor Dominios.exe"

[Run]
Filename: "{app}\Visor Dominios.exe"; Description: "Iniciar Visor Dominios"; Flags: nowait postinstall skipifsilent
