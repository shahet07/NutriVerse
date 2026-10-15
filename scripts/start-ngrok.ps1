#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Start an ngrok tunnel and hot-update PUBLIC_URL in the backend .env file.

.DESCRIPTION
    1. Starts `ngrok http <PORT>` as a background process.
    2. Polls the ngrok local API until a public HTTPS URL is assigned.
    3. Writes / updates the PUBLIC_URL= line in the project-root .env file.
    4. Prints a reminder to restart FastAPI so the new URL takes effect.

    The frontend (chef.tsx) fetches GET /config at runtime, so the QR code
    for the P2P Kitchen Remote updates without a Vite rebuild.

    For production you do NOT need ngrok — set PUBLIC_URL directly in your
    host's environment variables or secrets manager and remove/ignore this script.

.PARAMETER Port
    The local port to expose (default: 8000 for the FastAPI backend).
    Use 5173 instead if you want to expose the raw Vite dev server.

.EXAMPLE
    .\scripts\start-ngrok.ps1               # tunnel port 8000 (default)
    .\scripts\start-ngrok.ps1 -Port 5173    # tunnel the Vite dev server

.NOTES
    Requires ngrok to be installed and authenticated.
    Install: https://ngrok.com/download
    Auth:    ngrok config add-authtoken <YOUR_TOKEN>
#>

param(
    [int]$Port = 8000
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ── Locate project root (parent of this script's directory) ─────────────────
$ScriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir
$EnvFile    = Join-Path $ProjectRoot '.env'

Write-Host "`n[ngrok] Starting tunnel on port $Port ..." -ForegroundColor Cyan

# ── Start ngrok in the background ───────────────────────────────────────────
$ngrokJob = Start-Process -FilePath 'ngrok' `
    -ArgumentList "http $Port" `
    -PassThru -WindowStyle Minimized

Write-Host "[ngrok] Waiting for URL (up to 15 s) ..." -ForegroundColor DarkCyan

# ── Poll the ngrok local API ─────────────────────────────────────────────────
$ngrokApiUrl = 'http://127.0.0.1:4040/api/tunnels'
$publicUrl   = $null
$maxAttempts = 30  # 30 × 500 ms = 15 s

for ($i = 0; $i -lt $maxAttempts; $i++) {
    Start-Sleep -Milliseconds 500
    try {
        $resp   = Invoke-RestMethod -Uri $ngrokApiUrl -ErrorAction Stop
        $tunnel = $resp.tunnels | Where-Object { $_.proto -eq 'https' } | Select-Object -First 1
        if ($tunnel) {
            $publicUrl = $tunnel.public_url.TrimEnd('/')
            break
        }
    } catch {
        # ngrok not ready yet — keep waiting
    }
}

if (-not $publicUrl) {
    Write-Host "`n[ngrok] ERROR: Could not get a public URL after 15 s." -ForegroundColor Red
    Write-Host "        Make sure ngrok is installed and authenticated." -ForegroundColor Red
    Write-Host "        Install: https://ngrok.com/download" -ForegroundColor Yellow
    exit 1
}

Write-Host "[ngrok] Public URL: $publicUrl" -ForegroundColor Green

# ── Write PUBLIC_URL to .env ──────────────────────────────────────────────────
if (Test-Path $EnvFile) {
    $lines = Get-Content $EnvFile
    if ($lines -match '^PUBLIC_URL=') {
        # Update existing line
        $lines = $lines -replace '^PUBLIC_URL=.*', "PUBLIC_URL=$publicUrl"
        $lines | Set-Content $EnvFile -Encoding UTF8
        Write-Host "[env]   Updated  PUBLIC_URL in $EnvFile" -ForegroundColor Green
    } else {
        # Append new line
        Add-Content -Path $EnvFile -Value "`nPUBLIC_URL=$publicUrl" -Encoding UTF8
        Write-Host "[env]   Appended PUBLIC_URL to $EnvFile" -ForegroundColor Green
    }
} else {
    # Create minimal .env
    Set-Content -Path $EnvFile -Value "PUBLIC_URL=$publicUrl" -Encoding UTF8
    Write-Host "[env]   Created $EnvFile with PUBLIC_URL" -ForegroundColor Yellow
    Write-Host "        Add your Neo4j credentials to the .env file." -ForegroundColor Yellow
}

# ── Done ─────────────────────────────────────────────────────────────────────
Write-Host @"

[done] ngrok is running.

  Public URL : $publicUrl
  Chef Remote: $publicUrl/chef-remote

Next steps:
  1. Restart FastAPI so it picks up the new PUBLIC_URL:
         python run.py
  2. Open the Chef page in your browser, start a cooking session.
  3. The QR code will contain: $publicUrl/chef-remote?peer=<id>
  4. Scan with your phone — voice control will work over HTTPS.

To switch tunnel providers later (Cloudflare Tunnel, localtunnel, Railway,
Render, etc.) simply update PUBLIC_URL in the .env file and restart FastAPI.
"@ -ForegroundColor Cyan
