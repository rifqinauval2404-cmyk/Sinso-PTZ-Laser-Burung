# Sinso PTZ + Laser Bird Deterrent — Project Context

Pindah dari `C:\Users\PLN\Downloads\Sinso Control System V3.1.2\wall-e_burung` ke folder ini (2026-06-19). Baca file ini dulu sebelum lanjut kerja — semua protokol device udah confirmed live, jangan re-discover dari nol.

## Apa project ini

Ganti exe asli (`Sinso Control System V3.1.2.exe`) jadi web HMI (`hmi.html` + `server.js`) buat kendali PTZ + laser device bird-deterrent di IP `192.168.1.60`. Device fisik: kotak berdiri, motor pan (horizontal) + motor tilt (vertikal), kepala laser di atas (lihat foto device di percakapan awal — mirip kamera PTZ industrial).

## Arsitektur

```
hmi.html (browser, buka langsung file://)
   <-> WebSocket ws://localhost:8765
server.js (Node bridge, jalankan: npm install && node server.js)
   <-> raw TCP 192.168.1.60:4196 (Pelco-D protocol)
device fisik
```

`server.js` translate command WebSocket JSON jadi byte Pelco-D, kirim ke device, dan polling Position Query buat lapor posisi real-time balik ke browser.

File legacy lain di folder (ABAIKAN kecuali ditanya): `path-builder.html` (config builder buat 321.ini/322.ini/123.ini, project AWAL sebelum tau device sebenarnya PTZ bukan 99-channel relay — sudah obsolete tapi tidak dihapus), `*.ini` (config exe asli, tidak terpakai oleh hmi.html).

## Protokol Pelco-D — SUDAH CONFIRMED LIVE (jangan tebak ulang)

Semua byte di bawah sudah diverifikasi via capture jaringan asli (pktmon) + test langsung ke device, dan ada di komentar `server.js`.

| Aksi | Frame (hex) |
|---|---|
| stop | `FF 00 00 00 00 00 00` |
| pan-right | `FF 00 00 02 28 00 2A` |
| pan-left | `FF 00 00 04 28 00 2C` |
| tilt-up | `FF 00 00 08 00 3F 47` |
| tilt-down | `FF 00 00 10 00 3F 4F` |
| laser-on | `FF 00 00 09 00 02 0B` |
| laser-off | `FF 00 00 0B 00 02 0D` |

**Set Angle_H** (absolute pan): cmd2=`0x4B`. **Set Angle_V** (absolute tilt): cmd2=`0x4D`. Data = `degrees * 100`, 16-bit big-endian (Data1=high byte, Data2=low byte). Checksum = sum(Addr+Cmd1+Cmd2+Data1+Data2) & 0xFF.

**Query Angle_H**: send `FF 00 00 51 00 00 51` → reply `FF 00 00 59 [HI] [LO] cs` (cmd2=0x59 di reply). **Query Angle_V**: send `FF 00 00 53 00 00 53` → reply `FF 00 00 5B [HI] [LO] cs` (cmd2=0x5B di reply). Decode reply sama formula (HI<<8|LO)/100.

**PENTING — device cuma bisa handle 1 query at a time.** Kirim query H dan V bersamaan/cepat-cepat bikin device DROP salah satu balasan. `server.js` udah benar: kirim query H, TUNGGU balasannya, baru kirim query V (sequential, bukan `Promise.all` paralel). Kalau ada yang mau "optimasi jadi paralel lagi" — JANGAN, itu bug yang sudah pernah kejadian (bikin update posisi cuma sekali padahal device gerak 5+ detik).

## Limit mekanis device — SEBAGIAN confirmed, BELUM lengkap

Hasil test jog manual + Position Query polling (2026-06-19):
- **Tilt (V): min = 0°, max ≈ 57.9°** — confirmed (jog tilt-up terus 8+ detik, angka berhenti naik di situ, ketemu limit fisik/firmware).
- **Pan (H): max ≈ 298.27°** — confirmed (jog pan-right terus 8+ detik, berhenti di situ).
- **Pan (H): min = BELUM KETEMU.** Test jog pan-left terakhir kebaca H=78.73° dan masih terus turun pas koneksi device putus (user pindah lokasi/keluar site). **Lanjutkan dari sini**: jog pan-left lagi, poll query-position tiap 2-3 detik, sampai angka H berhenti berubah (itu limit minimumnya). Device kemungkinan TIDAK continuous-rotate — dia motor terbatas mekanis di kedua sumbu (H dan V), BUKAN dome/sphere penuh.

## Perbaikan hmi.html yang SUDAH dikerjakan (2026-07-02, belum ditest live)

Dua ronde perbaikan, semua di `hmi.html` (server.js tidak berubah):

**Ronde 1:**
- Konstanta range diganti: `ANGLE_H_MAX = 298`, `ANGLE_V_MAX = 58` (dulu 355/90). H-min masih placeholder 0 (belum ketemu, lihat TODO limit di atas). Catatan user: joint tilt desainnya bisa 0-180°, tapi limit confirmed-safe tetap ~58° sampai ditest ulang di site.
- Dome sphere DIHAPUS, diganti model bentuk alat asli: baseplate statis + badan pan (putar Y, 0-298°) + kepala laser (tilt di joint atas badan). `angleToVec3(h,v)` sekarang = posisi ujung kepala laser, `screenToAngle` raycast ke sphere jangkauan ujung kepala (radius HEAD_LEN di pivot).
- `goToWaypoint` sekarang kirim perintah laser saat MULAI gerak (bukan cuma saat sampai) — dulu laser gak dikirim ulang selama transit.

**Ronde 2 (koreksi user setelah lihat ronde 1):**
- Tema terang (dulu gelap, user gak nyaman), jog panel pindah ke samping canvas biar bisa jog sambil lihat table, layout responsive.
- Penanda orientasi: titik aperture + garis aim merah di moncong kepala laser, panah 0° di baseplate (acuan arah pan), tick label H0°/H298°/V58° di garis jangkauan.
- Marker smoothing: `sim` (posisi REPORTED dari device) dipisah dari `simDisplay` (posisi yang DIGAMBAR); loop rAF `stepAnim()` geser simDisplay ke sim dengan kecepatan dibatasi `PAN_DPS = 25` / `TILT_DPS = 15` deg/s (estimasi display-only, KALIBRASI di site kalau kelihatan beda dengan kecepatan motor asli). Ini fix marker yang dulu teleport/loncat instan kalau report posisi jarang.
- **Laser manual latch**: `manualLaser` (niat user) terpisah dari `laserOn` (indikator). Tombol Laser ON manual = latch — selama play, flag per-waypoint TIDAK BOLEH matikan laser; laser-on dikirim ulang tiap waypoint sebagai keep-alive. Laser baru mati kalau user tekan Laser OFF, atau saat Stop track kalau nyalanya cuma karena flag waypoint (bukan latch). Waypoint baru sekarang capture `manualLaser` (bukan `laserOn`).

**Perlu ditest live di site (device online):**
1. Play track dengan laser ON manual → laser harus nyala terus sepanjang putaran (ini keluhan utama user, vendor exe bisa).
2. Kecepatan glide marker vs putaran fisik — tune `PAN_DPS`/`TILT_DPS` kalau selisih jauh.
3. Klik dalam area jangkauan baru selalu sampai (gak mentok limit).
4. Lanjutkan cari H-min (jog pan-left + poll query-position sampai angka berhenti), lalu update `ANGLE_H_MAX`/min di hmi.html.

## Yang SUDAH terverifikasi jalan baik (jangan rombak tanpa alasan kuat)

- Manual jog (pan/tilt 4 arah + stop) — live tested, gerak sesuai arah.
- Laser ON/OFF — live tested ke device asli.
- goto-angle (set Angle_H + Angle_V sekaligus) — live tested, device gerak ke koordinat yang diminta.
- Position Query + polling real-time di `gotoAngleAndWait()` (server.js) — live tested, update lancar ~90ms per step setelah dioptimasi (sequential H-then-V, delay loop 20ms, bukan 150ms/60ms versi awal yang lambat).
- Dome 3D rendering (wireframe, orbit kamera via shift+drag/alt+drag, klik permukaan = taruh waypoint, raycast ke sphere buat convert klik 2D ke sudut H/V) — render & interaksi confirmed jalan, HANYA salah di rentang sudutnya (lihat bug di atas).
- Marker posisi real-time di canvas saat Play track mengikuti posisi asli device (bukan animasi tebakan) — confirmed sync setelah optimasi polling.

## Cara lanjut kerja

1. `cd "D:\AI Agent\sinso-ptz-bird-deterrent"`, `node server.js` (device harus online di 192.168.1.60, port 4196 reachable).
2. Buka `hmi.html` di browser.
3. Kalau device online: lanjutkan cari H-min (jog pan-left + query-position polling), lalu perbaiki konstanta range + bentuk dome di hmi.html.
4. Kalau device offline: tidak ada yang bisa ditest live, tunggu sampai user kembali ke site.
