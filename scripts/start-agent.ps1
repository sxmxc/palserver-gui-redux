# palserver GUI - starts the agent in development mode with tsx watch auto-reload.
# Usage: .\scripts\start-agent.ps1
# The first run prints the API token in the terminal and stores it in ~\.palserver-agent\token.
#
# This file is stored as UTF-8 with a BOM; otherwise Windows PowerShell 5.1 may misidentify its encoding.

$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

$Host.UI.RawUI.WindowTitle = "palserver agent"
pnpm dev:agent
