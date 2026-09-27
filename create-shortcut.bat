@echo off
title SimDash - desktop shortcut
rem A .bat can't carry its own icon, so this puts a SimDash shortcut on the desktop that runs start-bridge.bat
rem with simdash.ico. It starts through cmd.exe so the shortcut can also be pinned to the taskbar or Start.
set "SIMDASH=%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$d = $env:SIMDASH; $q = [char]34; $lnk = Join-Path ([Environment]::GetFolderPath('Desktop')) 'SimDash.lnk'; $s = (New-Object -ComObject WScript.Shell).CreateShortcut($lnk); $s.TargetPath = $env:ComSpec; $s.Arguments = '/c ' + $q + $q + $d + 'start-bridge.bat' + $q + $q; $s.WorkingDirectory = $d; $s.IconLocation = $d + 'simdash.ico,0'; $s.Description = 'SimDash bridge (MSFS + DCS)'; $s.Save(); Write-Host ('Created ' + $lnk)"
pause
