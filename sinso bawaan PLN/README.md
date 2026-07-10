# Sinso PTZ + Laser Bird Deterrent

Web HMI untuk mengendalikan device PTZ (pan-tilt-zoom) + laser bird-deterrent milik PLN — dipakai untuk menghalau burung dari instalasi listrik. Project ini menggantikan aplikasi kontrol bawaan (`Sinso Control System V3.1.2.exe`) dengan web app buatan sendiri, yang bicara ke device fisik lewat protokol **Pelco-D** melalui TCP (`192.168.1.60:4196` secara default).

Ada **dua cara menjalankan** project ini, bisa dipilih salah satu atau dijalankan berdampingan untuk dibandingkan:

- **Opsi A — Legacy**: satu file HTML + satu file Node.js, tanpa database. Cepat dicoba, sudah battle-tested langsung ke device asli.
- **Opsi B — Stack baru**: backend Node.js (Express + WebSocket + MySQL) dan frontend React (Vite). Track/waypoint/jadwal tersimpan di database, bukan cuma di browser.

---

## Opsi A — Menjalankan versi Legacy (cepat, tanpa database)

Dari folder root project:

```bash
npm install
node server.js
```

Ini menjalankan bridge WebSocket↔TCP di `ws://localhost:8765`, terhubung ke device di `192.168.1.60:4196` (override lewat env var `DEVICE_IP`/`DEVICE_PORT`/`WS_PORT` kalau perlu).

Lalu buka file `hmi.html` langsung di browser (`file://...`). Tidak perlu build/tooling apa pun.

---

## Opsi B — Menjalankan stack baru (Node.js + React + MySQL)

### 1. Siapkan database MySQL

Buat database kosong (nama bebas, contoh `sinso_ptz`), lalu jalankan skema tabelnya sekali:

```bash
mysql -u <user> -p sinso_ptz < backend/src/db/schema.sql
```

### 2. Jalankan backend

```bash
cd backend
cp .env.example .env
```

Edit `.env`, isi minimal:
- `MYSQL_HOST` / `MYSQL_PORT` / `MYSQL_USER` / `MYSQL_PASSWORD` / `MYSQL_DATABASE` — kredensial MySQL Anda.
- `API_KEY` — ganti dari `change-me` ke secret Anda sendiri (dicek di setiap request REST & koneksi WebSocket).
- `DEVICE_IP` / `DEVICE_PORT` — biarkan default kalau device masih di `192.168.1.60:4196`.

Lalu:

```bash
npm install
npm start
```

Backend jalan di `http://localhost:3001` — satu port untuk REST API, WebSocket kontrol device (`/ws`), dan (saat production) menyajikan build frontend.

### 3. Jalankan frontend

```bash
cd frontend
cp .env.example .env
```

Edit `.env`, isi `VITE_API_KEY` dengan nilai **yang sama persis** dengan `API_KEY` di `backend/.env`.

Lalu:

```bash
npm install
npm run dev
```

Buka `http://localhost:5173` di browser — ini mode development (Vite dev server, auto-reload saat kode diubah, otomatis proxy `/api` dan `/ws` ke backend di port 3001).

Untuk build production (dipakai backend untuk menyajikan langsung tanpa perlu `npm run dev` menyala terus):

```bash
npm run build
```

Hasil build masuk ke `frontend/dist/`, otomatis ke-serve oleh backend begitu backend dijalankan ulang.

---

## Struktur folder

```
sinso-ptz-bird-deterrent/
├── hmi.html, server.js, package.json   # Opsi A: legacy, single-file, tanpa database
├── backend/                            # Opsi B: Express + WebSocket + MySQL
│   ├── .env.example
│   └── src/
│       ├── device/     # protokol Pelco-D + koneksi TCP ke device (port verbatim dari server.js lama)
│       ├── ws/          # handler WebSocket kontrol real-time (jog/laser/goto-angle)
│       ├── db/          # schema.sql + koneksi & query MySQL (tracks, schedules, activity log)
│       └── routes/      # REST API (/api/tracks, /api/schedules, /api/activity-log)
├── frontend/                            # Opsi B: React + Vite
│   └── src/
│       ├── components/  # TrackCanvas (3D wireframe), JogPad, PlaybackPanel, ScheduleManager, dll.
│       └── api/         # client REST + hook WebSocket
├── path-builder.html, *.ini, install_driver.ps1, Sinso Control System V3.1.2.exe   # peninggalan lama, tidak dipakai
├── CLAUDE.md            # panduan teknis untuk AI coding assistant (konvensi, behavior yang dilindungi)
└── PROJECT_CONTEXT.md   # temuan protokol device & status TODO terkini
```

## Catatan

- Device fisik harus bisa dijangkau di IP yang dikonfigurasi (`DEVICE_IP:DEVICE_PORT`) — baik untuk Opsi A maupun Opsi B.
- Opsi A (port 8765) dan Opsi B (port 3001) bisa dijalankan **bersamaan** di mesin yang sama tanpa bentrok — berguna untuk membandingkan perilaku langsung, terutama saat menguji perubahan baru terhadap device asli.
- Untuk detail protokol Pelco-D yang sudah dikonfirmasi (jangan re-derive dari nol) dan batas mekanis device, baca `PROJECT_CONTEXT.md`. Untuk konvensi kode/behavior yang tidak boleh diregresi, baca `CLAUDE.md`.
