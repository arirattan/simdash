@echo off
title SimDash - install DCS export
cd /d "%~dp0bridge"
python install_dcs.py %*
pause
