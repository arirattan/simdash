@echo off
title SimDash - MobiFlight module for the G1000 keys
cd /d "%~dp0bridge"
python install_mobiflight.py %*
pause
