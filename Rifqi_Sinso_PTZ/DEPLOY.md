# Panduan Deploy — Sinso PTZ (nama project: `rifqi_sinso_ptz`)

Langkah upload & menjalankan aplikasi ini di server TJB (`10.8.242.8`).
Semua perintah dijalankan dari **jaringan intranet TJB**.

---

## Kenapa upload kemarin gagal

Perintah di `PANDUAN_PKL.md` ditulis begini:

```bash
scp -r ./project pkl@10.8.242.8:/data/www/pkl/<nama_project>/
```

Dua hal yang bikin gagal:

1. **`<nama_project>` itu placeholder**, bukan nama harfiah — harus diganti nama project sendiri (di sini: `rifqi_sinso_ptz`).
2. **`scp` tidak membuat folder tujuan.** Ia hanya menyalin ke folder yang **sudah ada**. Folder `/data/www/pkl/` memang sudah ada (kata pembimbing), tapi subfolder project kita belum. Makanya pembimbing bilang: *"create dulu folder-nya"*.

Jadi urutannya: **buat folder dulu (langkah 1) → baru upload (langkah 2)**.

---

## 1. Buat folder project di server

```bash
ssh pkl@10.8.242.8 "mkdir -p /data/www/pkl/rifqi_sinso_ptz"
```

## 2. Upload source dari laptop

Jalankan dari folder root project di laptop. Perhatikan: yang di-upload adalah **`backend` dan `frontend`** (isi dari `Rifqi_Sinso_PTZ/`), **bukan** folder `Rifqi_Sinso_PTZ`-nya sendiri — supaya di server keduanya bersebelahan langsung, tidak ter-nested.

```bash
cd "d:/KULIAH/MAGANG/PLN/robot laser burung/sinso-ptz-bird-deterrent"
scp -r ./Rifqi_Sinso_PTZ/backend ./Rifqi_Sinso_PTZ/frontend pkl@10.8.242.8:/data/www/pkl/rifqi_sinso_ptz/
```

> **Windows**: pakai **Git Bash** (path pakai `/`), atau PowerShell dengan `scp` bawaan OpenSSH.
> Path lokal mengandung spasi → wajib pakai tanda kutip.

**Kenapa struktur ini penting?** `backend/src/index.js` mencari file frontend di `../../frontend/dist` (dua tingkat ke atas dari `backend/src/`). Kalau `backend/` dan `frontend/` tidak bersebelahan, halaman web tidak akan tampil.

Struktur yang benar di server:

```
/data/www/pkl/rifqi_sinso_ptz/
├── backend/
│   ├── src/
│   ├── package.json
│   └── .env.example
└── frontend/
    ├── dist/          <- hasil build, ini yang disajikan ke browser
    └── src/
```

## 3. Cek hasil upload

```bash
ssh pkl@10.8.242.8
ls -la /data/www/pkl/rifqi_sinso_ptz/           # harus muncul: backend  frontend
ls /data/www/pkl/rifqi_sinso_ptz/frontend/dist  # harus muncul: index.html  assets/
```

## 4. Install dependency backend

`node_modules/` sengaja tidak di-upload (besar, buang kuota disk) — install di server:

```bash
cd /data/www/pkl/rifqi_sinso_ptz/backend
npm install --omit=dev
```

> Frontend **tidak perlu** `npm install` maupun `npm run build` di server, karena folder `dist/` (hasil build) sudah ikut ter-upload.

## 5. Buat file `.env` untuk production

Di `/data/www/pkl/rifqi_sinso_ptz/backend/`, buat file `.env` baru (`nano .env`).
**Jangan pakai `.env` dari laptop** — isinya kredensial & IP lokal.

```ini
PORT=54xx                # port dijatah pembimbing (5401-5449) - WAJIB, tidak ada cara melewatinya
HOST=127.0.0.1           # WAJIB. Jangan 0.0.0.0 (aturan server)
DEVICE_IP=10.8.242.50    # IP device PTZ setelah dipindah ke jaringan perusahaan
DEVICE_PORT=4196
API_KEY=<bikin string acak sendiri, jangan "change-me">
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=<dari pembimbing>
MYSQL_PASSWORD=<dari pembimbing>
MYSQL_DATABASE=<dari pembimbing>
CORS_ORIGIN=http://10.8.242.8
```

> **Belum dapat kredensial database dari pembimbing?** Tidak masalah, tidak perlu menunggu itu untuk lanjut. Aplikasi ini tetap bisa start dan menjalankan kontrol PTZ (jog/goto/laser) walau MySQL belum konek dengan benar - koneksi DB yang gagal cuma bikin fitur simpan Track/Jadwal error, tidak bikin backend mati. Isi `MYSQL_*` dengan nilai asal dulu (`MYSQL_USER=sinso`, `MYSQL_PASSWORD=sinso`, `MYSQL_DATABASE=sinso_ptz`) supaya bisa lanjut ke langkah 7 (PM2) dan memastikan "Forbidden" hilang - update lagi + `pm2 restart` begitu kredensial asli didapat. **PORT tetap wajib ditunggu dari pembimbing** - server ini dipakai bersama, port sembarangan berisiko bentrok dengan proses PKL lain atau aplikasi produksi.

Yang perlu diminta ke pembimbing IT: **port**, **nama + user + password database**, dan nanti **proxy**.

## 6. Import skema database

```bash
mysql -u <db_user> -p <db_name> < /data/www/pkl/rifqi_sinso_ptz/backend/src/db/schema.sql
```

## 7. Jalankan lewat PM2

```bash
cd /data/www/pkl/rifqi_sinso_ptz/backend
pm2 start src/index.js --name pkl-rifqi_sinso_ptz
pm2 save                              # WAJIB, biar hidup lagi setelah server reboot
pm2 logs pkl-rifqi_sinso_ptz          # cek ada error atau tidak
```

Tes dari dalam server (sebelum proxy dibuat):

```bash
curl http://127.0.0.1:54xx/api/health   # harus balas {"ok":true}
```

> `pm2 list` menampilkan proses milik teman PKL lain juga — **jangan restart/delete yang bukan milikmu**.

## 8. Minta proxy ke pembimbing

Lapor pembimbing untuk dibuatkan proxy `/pkl/rifqi_sinso_ptz/` → port yang dijatah.
Setelah jadi, aplikasi bisa dibuka di:

```
http://10.8.242.8/pkl/rifqi_sinso_ptz/
```

---

## Update kode setelah ada perubahan

**Kalau yang berubah backend:**
```bash
scp -r ./Rifqi_Sinso_PTZ/backend/src pkl@10.8.242.8:/data/www/pkl/rifqi_sinso_ptz/backend/
ssh pkl@10.8.242.8 "pm2 restart pkl-rifqi_sinso_ptz"
```

**Kalau yang berubah frontend:** build dulu di laptop, lalu upload `dist/`-nya.
```bash
cd frontend && npm run build && cd ..
cp -r ./frontend/dist ./Rifqi_Sinso_PTZ/frontend/
scp -r ./Rifqi_Sinso_PTZ/frontend/dist pkl@10.8.242.8:/data/www/pkl/rifqi_sinso_ptz/frontend/
```
(frontend tidak perlu restart PM2 — file statis langsung terbaca.)

---

## Troubleshooting

| Gejala | Kemungkinan penyebab |
|---|---|
| `scp: No such file or directory` | Folder tujuan belum dibuat → jalankan langkah 1 |
| `404` di `http://10.8.242.8/pkl/rifqi_sinso_ptz/` | Proxy belum dibuat pembimbing |
| **`Forbidden` (halaman Apache, bukan dari app kita)** | Wajar kalau belum sampai langkah 7 - artinya app belum pernah `pm2 start`, jadi proxy (kalau sudah dibuat) tidak ada backend untuk diteruskan. Selesaikan langkah 5-7 dulu |
| `503 Service Unavailable` | App mati → `pm2 list` & `pm2 logs pkl-rifqi_sinso_ptz` |
| Halaman putih, file `.js`/`.css` 404 | `frontend/dist/` tidak ter-upload, atau `backend/` & `frontend/` tidak bersebelahan |
| `Bridge/device not connected` di HMI | Backend hidup, tapi tidak bisa konek TCP ke device → cek `DEVICE_IP` di `.env` & jangkauan jaringan |
| Backend gagal start, error MySQL | Kredensial `.env` salah, atau `schema.sql` belum di-import (langkah 6) |
| `EADDRINUSE` saat start | Port dipakai proses lain → lapor pembimbing, jangan ganti port sendiri |
