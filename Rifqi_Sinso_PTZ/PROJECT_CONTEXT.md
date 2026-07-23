# Sinso PTZ + Laser Bird Deterrent — Project Context

Dokumen ini rangkuman lengkap project: apa ini, tech stack, cara menjalankan dari nol, dan semua temuan protokol/device yang sudah confirmed live (jangan re-derive dari nol, tinggal dipakai). Ditulis ulang 2026-07-14 menggantikan `PROJECT_CONTEXT.md` versi lama (isinya cerita era `hmi.html`+`server.js` yang sekarang sudah diarsipkan, lihat bagian "File/folder yang tidak dipakai lagi" di bawah).

## 1. Apa project ini

Web HMI (Human-Machine Interface) custom untuk mengendalikan device **PTZ (pan-tilt-zoom) + laser bird-deterrent** milik PLN — dipakai untuk menghalau burung dari instalasi listrik. Menggantikan aplikasi kontrol bawaan device (`Sinso Control System V3.1.2.exe`) yang sudah tidak nyaman dipakai dan tidak ada source code-nya.

Device fisik: kotak berdiri dengan motor pan (horizontal) + motor tilt (vertikal), kepala laser di atas — mirip kamera PTZ industrial. Dikendalikan lewat protokol **Pelco-D** melalui koneksi TCP mentah (bukan HTTP), pada IP `10.8.242.50` port `4196`.

## 2. Tech stack

| Bagian | Teknologi |
|---|---|
| Frontend : React 18 (`react`/`react-dom` ^18.3.1) + Vite 5 sebagai dev server/bundler |
| Komunikasi frontend↔backend | WebSocket native browser (kontrol real-time + posisi) + `fetch` REST (CRUD track/jadwal/log) |
| Backend : Node.js + Express 4 (REST API) + `ws` 8 (WebSocket server) |
| Komunikasi backend↔device | Node `net` module — raw TCP socket, protokol Pelco-D (bukan library pihak ketiga) |
| Database : MySQL/MariaDB, driver `mysql2` — tabel tracks, track_waypoints, schedules, activity_log |
| Env/config : `dotenv` |
| Proses production : PM2 (dipakai di server deploy, lihat bagian 12) |
| Node version | Tidak ada `engines` field eksplisit di `package.json`; environment pengembangan pakai Node v24. Node 18 LTS ke atas seharusnya aman (dev script backend pakai `node --watch`, butuh Node ≥18.11) |

## 3. Arsitektur

```
Browser (React SPA)
   <-> WebSocket ws://.../ws  (kontrol real-time: jog, goto-angle, laser, query-position)
   <-> REST      http://.../api/*  (CRUD tracks, schedules, activity-log)
Backend (Node.js + Express, backend/src/index.js)
   <-> raw TCP 10.8.242.50:4196 (protokol Pelco-D) --> device fisik
   <-> MySQL/MariaDB (tracks, track_waypoints, schedules, activity_log)
```

Backend juga men-serve hasil build React (`frontend/dist`) secara langsung lewat `express.static` — jadi di production cukup **satu proses, satu port** (lihat `backend/src/index.js`).

Backend menjalankan **Jadwal Otomatis** (`scheduler/scheduleRunner.js`) sepenuhnya di sisi server sendiri (bukan lewat browser) — jadi jadwal tetap jalan walau tidak ada tab browser yang terbuka sama sekali. Ini best-effort/independen dari koneksi WebSocket manapun.

## 4. Struktur folder

```
backend/src/
  index.js              entry point: setup Express + WS server + serve frontend/dist
  config.js             baca semua env var (lihat tabel bagian 7)
  auth.js                cek X-Api-Key (REST) / ?key= (WS)
  device/
    pelco.js             frame Pelco-D (build command bytes, checksum) — lihat bagian 8
    deviceClient.js       koneksi TCP ke device, goto-angle + polling posisi
  db/
    pool.js               koneksi MySQL pool
    schema.sql             DDL semua tabel (idempotent, aman dijalankan ulang)
    tracksRepo.js, schedulesRepo.js, activityLogRepo.js   query per tabel
  routes/
    tracks.js, schedules.js, activityLog.js   REST endpoint (dipasang di index.js dengan requireApiKey)
  scheduler/
    scheduleRunner.js      jalankan Jadwal Otomatis independen dari browser
  ws/
    controlSocket.js       handler pesan WebSocket (command jog/goto/laser/query-position)

frontend/src/
  App.jsx                 state utama: waypoints, playback (Play/Stop/loop), koneksi WS
  constants.js            konstanta device (limit sudut, kecepatan jog, keep-alive interval)
  main.jsx                entry point React
  api/
    client.js              wrapper fetch ke /api/*
    useWebSocket.js         hook koneksi WS + reconnect
  components/
    JogPad.jsx              kontrol manual (panah arah + stop)
    LaserControls.jsx        tombol laser ON/OFF
    PlaybackPanel.jsx         Play/Stop track, input "Tahan"/"Diam di awal", simpan/load track
    ScheduleManager.jsx        CRUD Jadwal Otomatis
    ActivityLog.jsx            tampilan log aktivitas
    StatusBar.jsx               indikator bridge/device connected
    WaypointTable.jsx            tabel waypoint track saat ini
    TrackCanvas/                canvas 3D wireframe (aiming + waypoint builder)
```


## 5. Yang harus diinstal (prasyarat)

- **Node.js** (v18+ disarankan, v24 yang dipakai saat pengembangan) — termasuk `npm`.
- **MySQL atau MariaDB** — bisa pakai XAMPP (sudah terbukti dipakai di environment pengembangan ini) atau instalasi native. MariaDB 10.3+ cukup.
- Tidak perlu install apa pun secara global untuk menjalankan device (koneksi TCP langsung pakai modul bawaan Node `net`).

## 6. Cara menjalankan dari nol (lokal/development)

### a. Setup database
```bash
# masuk ke MySQL client (contoh via XAMPP: C:\xampp\mysql\bin\mysql.exe -u root)
mysql -u root -e "CREATE DATABASE IF NOT EXISTS sinso_ptz;"
mysql -u root sinso_ptz < backend/src/db/schema.sql
```
`schema.sql` aman dijalankan berkali-kali (pakai `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` untuk migrasi kolom baru).

### b. Setup & jalankan backend
```bash
cd backend
cp .env.example .env
# edit .env: isi DEVICE_IP (default sudah 10.8.242.50), MYSQL_USER/PASSWORD sesuai
# instalasi lokal Anda, dan API_KEY (boleh biarkan "change-me" untuk dev lokal)
npm install
npm start          # atau: npm run dev (auto-restart pakai --watch saat file berubah)
```
Backend berjalan di `http://localhost:3001` (REST `/api/*` + WebSocket `/ws`).

### c. Setup & jalankan frontend
```bash
cd frontend
cp .env.example .env
# edit VITE_API_KEY supaya SAMA PERSIS dengan API_KEY di backend/.env
npm install
npm run dev
```
Buka `http://localhost:5173` di browser. Vite dev server otomatis proxy `/api` dan `/ws` ke backend port 3001 (lihat `frontend/vite.config.js`).

### d. Build production (opsional, untuk deploy)
```bash
cd frontend
npm run build       # hasil di frontend/dist/
```
Backend otomatis men-serve `frontend/dist/` lewat `express.static` — jadi cukup jalankan backend saja (`node backend/src/index.js`) dan buka langsung `http://localhost:3001/` tanpa perlu Vite dev server sama sekali. Ini pola yang dipakai saat deploy ke server (bagian 12).

## 7. Environment variables (backend/.env)

| Variabel | Default | Keterangan |
|---|---|---|
| `DEVICE_IP` | `10.8.242.50` | IP device PTZ fisik (lihat bagian 10 soal riwayat perubahan IP) |
| `DEVICE_PORT` | `4196` | Port Pelco-D device |
| `PORT` | `3001` | Port HTTP/WS backend |
| `HOST` | `0.0.0.0` | Interface bind backend. Default terbuka ke semua interface (supaya HP/tablet di LAN bisa akses langsung). **Set ke `127.0.0.1` kalau deploy di belakang reverse proxy** (server PKL/produksi) — tidak ada di `.env.example` tapi didukung penuh di `config.js` |
| `API_KEY` | `change-me` | Shared secret, dicek di header `X-Api-Key` (REST) & query `?key=` (WS). **Ganti sebelum deploy sungguhan** |
| `MYSQL_HOST` | `localhost` | |
| `MYSQL_PORT` | `3306` | |
| `MYSQL_USER` | `sinso` | |
| `MYSQL_PASSWORD` | `change-me` | |
| `MYSQL_DATABASE` | `sinso_ptz` | |
| `CORS_ORIGIN` | `http://localhost:5173` | Origin yang diizinkan akses REST dari browser (dev: Vite; production: biasanya sama seperti domain aplikasinya) |

Frontend (`frontend/.env`): cuma `VITE_API_KEY` — **harus sama persis** dengan `API_KEY` backend.

## 8. Protokol Pelco-D — confirmed live, JANGAN re-derive dari nol

Semua di bawah sudah diverifikasi lewat capture jaringan asli + test langsung ke device fisik. Detail byte ada di `backend/src/device/pelco.js`.

Frame umum: `FF [Addr=00] [Cmd1] [Cmd2] [Data1] [Data2] [Checksum]`, checksum = sum semua byte sebelumnya & 0xFF.

| Aksi | Cmd1 | Cmd2 | Data1 | Data2 |
|---|---|---|---|---|
| stop | `00` | `00` | `00` | `00` |
| pan-right | `00` | `02` | `28` | `00` |
| pan-left | `00` | `04` | `28` | `00` |
| tilt-up | `00` | `08` | `00` | `3f` |
| tilt-down | `00` | `10` | `00` | `3f` |
| laser-on | `00` | `09` | `00` | `02` |
| laser-off | `00` | `0b` | `00` | `02` |
| Set Angle_H (absolut) | `00` | `4b` | hi | lo — nilai = derajat×100, 16-bit big-endian |
| Set Angle_V (absolut) | `00` | `4d` | hi | lo — sama encoding |
| Query Angle_H | `00` | `51` | `00` | `00` — balasan cmd2=`59` |
| Query Angle_V | `00` | `53` | `00` | `00` — balasan cmd2=`5b` |

**Aturan penting**: device cuma bisa proses **1 query posisi dalam satu waktu**. `deviceClient.getPosition()` query H, TUNGGU balasannya, baru query V — sequential, BUKAN paralel (`Promise.all`). Ini sudah pernah dicoba dioptimasi jadi paralel dan menyebabkan balasan silent-drop (update posisi berhenti di tengah gerakan). Lihat komentar di `deviceClient.js`.

**⚠️ Command Preset Pelco-D standar (`0x03` Set Preset / `0x05` Clear Preset / `0x07` Call Preset) SUDAH DICOBA (2026-07-13) DAN TERBUKTI TIDAK AMAN** — device TIDAK diam di posisi preset seperti seharusnya, malah bergerak terus-menerus di kedua sumbu tanpa berhenti sendiri sampai dikirim `stop` manual (diuji: H bergerak 94→120→194° dan V 38→29→10° dalam ~7 detik). Kesimpulan: device ini kemungkinan implementasi Pelco-D parsial/clone yang tidak mendukung preset dengan benar. **Jangan kirim command ini atau command lain di luar tabel di atas tanpa pengawasan ketat + siap kirim `stop` segera.**

## 9. Limit mekanis device

- **Tilt (V): 0° – ~58°** — confirmed (jog manual sampai mentok).
- **Pan (H): max ≈ 298°** — confirmed.
- **Pan (H): min — BELUM DITEMUKAN.** Placeholder 0 dipakai di `frontend/src/constants.js` (`ANGLE_H_MAX = 298`). TODO: jog pan-left terus sambil poll query-position sampai angka berhenti berubah, itu limit minimumnya, lalu update konstanta di frontend.

## 10. Temuan penting soal device (di luar protokol)

1. **Device auto-kembali ke posisi preset tetap (H≈94°, V≈38°) kalau idle >45–50 detik tanpa command GERAK** (confirmed lewat pengujian bertahap 15/30/45/50/60 detik). Command baca (`query-position`) TIDAK mereset timer idle ini — hanya command gerak (`goto-angle`) yang mereset. **Solusi yang sudah diimplementasikan**: selama dwell/jeda lebih lama dari `DWELL_KEEPALIVE_MS` (20 detik, didefinisikan di `frontend/src/constants.js` DAN `backend/src/scheduler/scheduleRunner.js` — **kedua tempat ini harus tetap sinkron**), sistem resend `goto-angle` ke posisi yang sama secara periodik supaya device tidak pernah idle cukup lama untuk trigger auto-return-nya.
2. **Device punya web admin panel sendiri**, diakses langsung lewat browser ke IP device (`http://10.8.242.50/`) — dipakai untuk ubah setting jaringan (termasuk IP). Ini terpisah total dari kontrol Pelco-D di atas, tidak ada hubungannya dengan temuan #1.
3. **IP device**: sekarang `10.8.242.50` (sebelumnya `192.168.1.60`, berubah karena device dipindah ke jaringan perusahaan/TJB untuk keperluan deploy ke server PKL). Port Pelco-D (`4196`) tidak berubah.

## 11. Fitur & behavior yang sudah confirmed jalan — jangan dirombak tanpa alasan kuat

- **Manual jog**: satu klik/tap = satu gerak pendek terbatas (`JOG_NUDGE_MS = 200` di `constants.js`), auto-stop, BUKAN gerak panjang selama tombol ditekan.
- **Laser manual latch**: `manualLaser` (niat user) terpisah dari `laserOn` (indikator). Saat playback, flag laser per-waypoint TIDAK BOLEH mematikan laser kalau user sudah latch manual ON; laser-on dikirim ulang tiap waypoint sebagai keep-alive.
- **Marker smoothing di canvas**: `sim` (posisi REPORTED device) terpisah dari `simDisplay` (posisi yang DIGAMBAR), digeser rAF loop dibatasi `PAN_DPS`/`TILT_DPS` deg/s (estimasi display-only). Jangan gambar `sim` langsung — itu bikin marker teleport/loncat.
- **Dwell tersimpan PER TRACK di database** (`dwell_ms` = "Tahan" antar-titik, `loop_dwell_ms` = "Diam di awal" setelah balik ke titik awal) — dipakai baik oleh Play manual (`App.jsx`) MAUPUN Jadwal Otomatis (`scheduleRunner.js`). Keduanya punya implementasi keep-alive dwell yang mirror satu sama lain (`scheduleDwell()` di frontend, `dwellWait()` di backend) — kalau salah satu diubah, cek yang satunya juga.
- **`playPhaseRef` state machine** (`App.jsx`, nilai `"moving"`/`"dwelling"`) dan `justLooped`/`session.justLooped` (backend) — mencegah balasan "arrived" dari keep-alive resend salah memicu ulang logic lanjut-ke-waypoint-berikutnya.

## 12. Deployment ke server PKL (TJB)

Project ini sudah di-deploy ke server intranet perusahaan (`10.8.242.8`), folder `/data/www/pkl/rifqi_sinso_ptz/`. Panduan lengkap (termasuk kenapa `scp` awal sempat gagal & troubleshooting) ada di **`Rifqi_Sinso_PTZ/DEPLOY.md`** — bagian ini rangkuman langkah **untuk MENYALAKAN aplikasi setelah file (`backend/`, `frontend/`, `PROJECT_CONTEXT.md`) sudah ter-upload ke server**.

Semua langkah di bawah dijalankan **di dalam server** (`ssh pkl@10.8.242.8` dulu), bukan di laptop.

### a. Install dependency backend
```bash
cd /data/www/pkl/rifqi_sinso_ptz/backend
npm install --omit=dev
```
Frontend tidak perlu `npm install`/build di server — `frontend/dist/` (hasil build) sudah ikut ter-upload.

### b. Minta ke pembimbing IT (kalau belum punya)
- **Port** (dijatah dari rentang 5401–5449) — **wajib**, jangan pilih sendiri (server dipakai bersama, resiko bentrok proses lain).
- **Kredensial database**: nama DB + user + password MariaDB.
- (Nanti setelah aplikasi jalan) **proxy** `/pkl/rifqi_sinso_ptz/` → port yang dijatah.

### c. Buat file `.env` production
Di `/data/www/pkl/rifqi_sinso_ptz/backend/` (`nano .env`) — **jangan pakai `.env` dari laptop**, isinya kredensial/IP lokal yang beda:
```ini
PORT=54xx                # dari pembimbing - wajib
HOST=127.0.0.1           # wajib, jangan 0.0.0.0
DEVICE_IP=10.8.242.50
DEVICE_PORT=4196
API_KEY=<buat string acak sendiri, jangan "change-me">
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=<dari pembimbing>
MYSQL_PASSWORD=<dari pembimbing>
MYSQL_DATABASE=<dari pembimbing>
CORS_ORIGIN=http://10.8.242.8
```
> Belum dapat kredensial DB? Boleh isi `MYSQL_*` asal dulu (mis. `sinso`/`sinso`/`sinso_ptz`) supaya bisa lanjut ke langkah PM2 — backend tetap start dan kontrol PTZ (jog/goto/laser) tetap jalan walau MySQL gagal konek, cuma fitur simpan Track/Jadwal yang error sampai kredensial asli diisi + `pm2 restart`. **PORT tetap wajib ditunggu dari pembimbing**, tidak ada cara amannya melewati ini.

### d. Import skema database
```bash
mysql -u <db_user> -p <db_name> < /data/www/pkl/rifqi_sinso_ptz/backend/src/db/schema.sql
```

### e. Jalankan lewat PM2
```bash
cd /data/www/pkl/rifqi_sinso_ptz/backend
pm2 start src/index.js --name pkl-rifqi_sinso_ptz
pm2 save                              # wajib, biar hidup lagi setelah server reboot
pm2 logs pkl-rifqi_sinso_ptz          # cek error
```
Tes dari dalam server (sebelum proxy dibuat): `curl http://127.0.0.1:54xx/api/health` harus balas `{"ok":true}`. (`pm2 list` menampilkan proses teman PKL lain juga — jangan restart/delete yang bukan milik sendiri.)

### f. Minta proxy ke pembimbing
Lapor pembimbing untuk dibuatkan proxy `/pkl/rifqi_sinso_ptz/` → port tadi. Setelah jadi, aplikasi bisa dibuka di `http://10.8.242.8/pkl/rifqi_sinso_ptz/`.

### Kalau ada error saat langkah di atas
Lihat tabel troubleshooting di `Rifqi_Sinso_PTZ/DEPLOY.md` (gejala umum: `Forbidden` = app belum `pm2 start`, `404` = proxy belum dibuat, halaman putih = `frontend/dist` tidak lengkap/tidak sejajar `backend`, dll).

### Update kode ke depannya (setelah ada perubahan di laptop)
**Backend berubah:**
```bash
scp -r ./Rifqi_Sinso_PTZ/backend/src pkl@10.8.242.8:/data/www/pkl/rifqi_sinso_ptz/backend/
ssh pkl@10.8.242.8 "pm2 restart pkl-rifqi_sinso_ptz"
```
**Frontend berubah** (build dulu di laptop, upload `dist/`-nya, tidak perlu restart PM2):
```bash
cd frontend && npm run build && cd ..
cp -r ./frontend/dist ./Rifqi_Sinso_PTZ/frontend/
scp -r ./Rifqi_Sinso_PTZ/frontend/dist pkl@10.8.242.8:/data/www/pkl/rifqi_sinso_ptz/frontend/
```

Catatan teknis penting yang melandasi kenapa kode ditulis seperti sekarang:
- `frontend/vite.config.js` pakai `base: "./"` (path relatif) supaya build tetap benar walau disajikan dari sub-path (`/pkl/rifqi_sinso_ptz/`) di belakang reverse proxy.
- `frontend/src/api/client.js` (fetch) dan `frontend/src/api/useWebSocket.js` (WS URL) dihitung relatif terhadap halaman saat ini, bukan hardcode path absolut dari root domain — supaya jalan baik di lokal (`/`) maupun di sub-path server.
- `backend/src/config.js` punya `HOST` configurable (default `0.0.0.0` lokal, di-set `127.0.0.1` di server produksi) — server PKL mewajibkan backend cuma bind ke loopback, diakses lewat reverse proxy Apache.

## 13. TODO / belum lengkap

- Cari batas minimum Pan (H) — lihat bagian 9.
- Belum ada cara mematikan fitur auto-return-to-preset device secara permanen (bukan lewat command Pelco-D, karena preset command terbukti tidak aman dicoba — lihat bagian 8). Mitigasi saat ini murni software (keep-alive), bukan menghilangkan akar perilaku device.
- Kredensial database & port production di server PKL menunggu konfirmasi final dari pembimbing IT (lihat `Rifqi_Sinso_PTZ/DEPLOY.md` langkah 5-8).
