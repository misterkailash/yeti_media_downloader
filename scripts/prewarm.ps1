# Waits for the Nuxt dev server on port 3000 to start accepting connections,
# fires a single GET / to force Vite to compile the homepage route, then
# opens the default browser. Invoked from start.bat in the background so
# the user lands on a fully-rendered page instead of a blank "compiling..."
# screen.
#
# Writes a timestamped log to scripts/prewarm.log so we can diagnose the
# rare cases where the browser open fails silently.
#
# Note on localhost vs 127.0.0.1: Nuxt's default `localhost` host can
# resolve to either ::1 (IPv6) or 127.0.0.1 (IPv4) depending on Windows
# DNS - we probe both so we don't hang waiting for the wrong family.

$ErrorActionPreference = 'SilentlyContinue'

$logFile = Join-Path $PSScriptRoot 'prewarm.log'
function Log($msg) {
    "$(Get-Date -Format 'HH:mm:ss.fff')  $msg" | Add-Content -Path $logFile
}

"=== Prewarm started $(Get-Date) ===" | Out-File -FilePath $logFile

$deadline = (Get-Date).AddSeconds(180)
$ready = $false
$ipv4Err = ''
$ipv6Err = ''
$attempts = 0

while ((Get-Date) -lt $deadline) {
    foreach ($addr in @('127.0.0.1', '::1')) {
        $client = New-Object System.Net.Sockets.TcpClient
        try {
            $client.Connect($addr, 3000)
            $client.Close()
            $ready = $true
            Log "Port 3000 reachable via $addr after $attempts attempts"
            break
        } catch {
            if ($addr -eq '127.0.0.1') { $ipv4Err = "$_" } else { $ipv6Err = "$_" }
            try { $client.Close() } catch { }
        }
    }
    if ($ready) { break }
    $attempts++
    if ($attempts % 20 -eq 0) {
        Log "Still polling ($attempts attempts) - ipv4: $ipv4Err / ipv6: $ipv6Err"
    }
    Start-Sleep -Milliseconds 300
}

if ($ready) {
    # Pre-compile the homepage. 60s budget covers cold Vite compiles.
    try {
        Invoke-WebRequest -Uri 'http://localhost:3000/' -UseBasicParsing -TimeoutSec 60 | Out-Null
        Log "Prewarm GET / completed"
    } catch {
        Log "Prewarm GET / failed: $_"
    }
} else {
    Log "Timed out waiting for port 3000 - opening browser anyway"
}

# Open the default browser. `cmd /c start ""` is the most reliable URL
# opener on Windows - it uses the system file association without any
# of the COM / Start-Process quirks that can fail in a background process.
Log "Opening browser via cmd start"
& cmd /c start "" "http://localhost:3000/"
Log "Done"
