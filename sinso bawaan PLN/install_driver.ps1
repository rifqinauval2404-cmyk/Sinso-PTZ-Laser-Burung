# Script Install Driver Corechip SR9900 USB 10/100 LAN Adapter
# Hardware: USB\VID_0FE6&PID_9900

$ErrorActionPreference = "Stop"
$driverFolder = "$env:TEMP\SR9900_driver"

Write-Host "=== Install Driver USB LAN Adapter (Corechip SR9900) ===" -ForegroundColor Cyan
Write-Host ""

# Cek apakah device ada
$device = Get-PnpDevice | Where-Object { $_.InstanceId -like "*VID_0FE6*PID_9900*" }
if (-not $device) {
    Write-Host "ERROR: USB LAN Adapter tidak terdeteksi. Pastikan adapter sudah dicolokkan ke USB." -ForegroundColor Red
    exit 1
}
Write-Host "[OK] Device ditemukan: $($device.FriendlyName) - Status: $($device.Status)" -ForegroundColor Green

# Buat folder temp
if (Test-Path $driverFolder) { Remove-Item $driverFolder -Recurse -Force }
New-Item -ItemType Directory -Path $driverFolder | Out-Null
Write-Host "[OK] Folder temp dibuat: $driverFolder" -ForegroundColor Green

# Download driver dari Microsoft Update Catalog
# Driver ID untuk Corechip SR9900 / USB 10-100 LAN (VID_0FE6&PID_9900)
$updateId = "bc527099-e2ae-44c2-a2e2-a3ebb3db0f1f"
$revisionId = "211"
$downloadUrl = "https://catalog.sf.dl.delivery.mp.microsoft.com/filestreamingservice/files/ba0fe79f-1b52-4c0a-b0f0-b63a6e5e0bbb/package_5e49db2c-00e3-4ffe-a574-8e58c4745cd7.cab"

Write-Host ""
Write-Host "Mencoba download driver dari Microsoft Update Catalog..." -ForegroundColor Yellow

try {
    $cabFile = "$driverFolder\SR9900.cab"
    Invoke-WebRequest -Uri $downloadUrl -OutFile $cabFile -UseBasicParsing
    Write-Host "[OK] Download selesai." -ForegroundColor Green

    # Extract .cab
    Write-Host "Mengekstrak driver..." -ForegroundColor Yellow
    $extractPath = "$driverFolder\extracted"
    New-Item -ItemType Directory -Path $extractPath | Out-Null
    expand.exe $cabFile -F:* $extractPath | Out-Null
    Write-Host "[OK] Ekstrak selesai." -ForegroundColor Green

    # Install driver via pnputil
    Write-Host "Menginstall driver..." -ForegroundColor Yellow
    $infFile = Get-ChildItem $extractPath -Filter "*.inf" | Select-Object -First 1
    if ($infFile) {
        pnputil /add-driver $infFile.FullName /install
        Write-Host "[OK] Driver diinstall." -ForegroundColor Green
    } else {
        Write-Host "WARN: File .inf tidak ditemukan di dalam .cab" -ForegroundColor Yellow
        Write-Host "Isi folder ekstrak:" -ForegroundColor Yellow
        Get-ChildItem $extractPath | ForEach-Object { Write-Host "  $_" }
    }
} catch {
    Write-Host "WARN: Download dari Microsoft Catalog gagal: $_" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Mencoba download dari mirror alternatif..." -ForegroundColor Yellow
    
    # Alternatif: download .inf langsung dari sumber lain
    # Ini menggunakan Windows Update API untuk cari driver
    try {
        $wuSession = New-Object -ComObject "Microsoft.Update.Session"
        $wuSearcher = $wuSession.CreateUpdateSearcher()
        $wuSearcher.Online = $true
        Write-Host "Mencari driver via Windows Update..." -ForegroundColor Yellow
        $results = $wuSearcher.Search("HardwareID='USB\VID_0FE6&PID_9900'")
        if ($results.Updates.Count -gt 0) {
            Write-Host "[OK] Driver ditemukan di Windows Update:" -ForegroundColor Green
            $results.Updates | ForEach-Object { Write-Host "  - $($_.Title)" }
        } else {
            Write-Host "Tidak ada driver di Windows Update." -ForegroundColor Red
        }
    } catch {
        Write-Host "Windows Update search juga gagal: $_" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "=== Cek status adapter setelah install ===" -ForegroundColor Cyan
Start-Sleep -Seconds 3
$deviceAfter = Get-PnpDevice | Where-Object { $_.InstanceId -like "*VID_0FE6*PID_9900*" }
if ($deviceAfter) {
    Write-Host "Status: $($deviceAfter.Status) | Class: $($deviceAfter.Class)" -ForegroundColor $(if ($deviceAfter.Status -eq 'OK') { 'Green' } else { 'Red' })
}

# Tampilkan semua adapter jaringan sekarang
Write-Host ""
Write-Host "=== Adapter Jaringan Aktif ===" -ForegroundColor Cyan
Get-NetAdapter | Select-Object Name, Status, LinkSpeed, MacAddress | Format-Table -AutoSize

Write-Host ""
Write-Host "Selesai. Jika status adapter sudah 'OK', silakan set IP statis:" -ForegroundColor Cyan
Write-Host "  netsh interface ip set address name='Ethernet' static 192.168.1.100 255.255.255.0" -ForegroundColor White
