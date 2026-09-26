@echo off
title SimDash - live screens for DCS
cd /d "%~dp0bridge"
python setup_screens.py %*
pause
