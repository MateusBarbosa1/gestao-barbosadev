@echo off
cd /d "%~dp0"
if not exist node_modules call npm install
start "" http://localhost:3000
if exist .env (node --env-file=.env server.js) else (node server.js)
