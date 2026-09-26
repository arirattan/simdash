@echo off
title SimDash bridge (SimHub mode)
cd /d "%~dp0bridge"
python bridge.py --source simhub %*
if errorlevel 1 pause
