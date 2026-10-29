# One-time setup on Windows: installs what the Agent needs, makes it start with Windows, starts it now,
# and opens the Chrome page where the Showrun helper is loaded.
# Run: right-click > Run with PowerShell   (or: powershell -ExecutionPolicy Bypass -File scripts\install-windows.ps1)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$backend = Join-Path $root "backend"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "Showrun needs Node.js 24 or newer. Install it from https://nodejs.org, then run this again." -ForegroundColor Yellow
  exit 1
}
$major = [int]((node --version).TrimStart("v").Split(".")[0])
if ($major -lt 24) { Write-Host "Node.js $major is too old; Showrun needs 24 or newer (https://nodejs.org)." -ForegroundColor Yellow; exit 1 }

Write-Host "Installing the Showrun Agent..."
Push-Location $backend
npm install --no-audit --no-fund | Out-Null
Pop-Location

# Start with Windows: a shortcut to the hidden launcher in the Startup folder.
$startup = [Environment]::GetFolderPath("Startup")
$lnk = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $startup "Showrun Agent.lnk"))
$lnk.TargetPath = "wscript.exe"
$lnk.Arguments = '"' + (Join-Path $root "start-showrun.vbs") + '"'
$lnk.WorkingDirectory = $root
$lnk.Description = "Showrun Agent"
$lnk.Save()

# Start it now unless it is already running.
$up = $false
try { $up = (Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 "http://127.0.0.1:3200/api/sessions").StatusCode -eq 200 } catch {}
if (-not $up) { Start-Process wscript.exe -ArgumentList ('"' + (Join-Path $root "start-showrun.vbs") + '"') }

Write-Host ""
Write-Host "The Showrun Agent is running and will start with Windows." -ForegroundColor Green
Write-Host "Last step, once: in the Chrome tab that opens, turn on Developer mode, click 'Load unpacked' and pick:"
Write-Host "  $(Join-Path $root 'extension')"
Write-Host "Then click the Showrun icon in the Chrome toolbar."
Start-Process "chrome.exe" "chrome://extensions" -ErrorAction SilentlyContinue
