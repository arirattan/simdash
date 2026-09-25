@echo off
title SimDash bridge
cd /d "%~dp0bridge"
python bridge.py %*
if errorlevel 1 pause
