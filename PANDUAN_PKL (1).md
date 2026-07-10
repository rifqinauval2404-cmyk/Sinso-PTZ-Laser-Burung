# Panduan Deploy Aplikasi — Anak PKL (Server TJB)

Panduan untuk teman-teman PKL meng-online-kan aplikasi web di server intranet TJB.
Semua file & proses kalian **HANYA** di `/data/www/pkl/<nama_project>/`. Folder lain = aplikasi produksi pembangkit, jangan disentuh.

## Info koneksi

| Hal | Nilai |
|---|---|
| Host | `10.8.242.8` (hanya dari **jaringan intranet TJB** — bukan via internet/VPN) |
| SSH | port 22, user **`pkl`** (password: minta ke pembimbing IT) |
| Folder kerja | `/data/www/pkl/<nama_project>/` |
| URL aplikasi | `http://10.8.242.8/pkl/<nama_project>/` |
| Node.js | v24 (nvm) — sudah terpasang |
| PHP (Laravel) | `php8.2` (untuk `artisan serve`) |
| Database | MariaDB 10.3 di `127.0.0.1:3306` (1 DB per project, minta ke pembimbing) |
| Port backend | **5401–5449**, dijatah pembimbing — jangan pilih sendiri |

---

## B.1 Tata tertib (WAJIB dibaca)

1. Kerja **hanya** di `/data/www/pkl/<nama_project>/`. Folder lain di server = aplikasi produksi pembangkit.
2. Port backend **minta ke pembimbing IT** (dijatah 5401–5449). Jangan pilih sendiri, jangan pakai 3000/8080 dll — sudah dipakai app produksi.
3. Backend selalu bind ke `127.0.0.1`, **jangan pernah `0.0.0.0`**. Pegawai mengakses lewat `http://10.8.242.8/pkl/<nama_project>/`, bukan lewat port langsung.
4. Password DB & API key taruh di `.env`, jangan hardcode di kode. `.env` sudah otomatis diblok dari web.
5. Nama proses PM2 wajib `pkl-<nama_project>`. User `pkl` dipakai **bersama** — `pm2 list` menampilkan proses teman kalian juga. **Jangan restart/delete proses yang bukan punyamu.**
6. Selesai masa PKL: backup kodemu sendiri, lalu lapor pembimbing untuk pembersihan folder + port + DB.

## B.2 Cara akses & upload

Dari laptop di jaringan intranet TJB:

```bash
ssh pkl@10.8.242.8                                              # terminal
scp -r ./project pkl@10.8.242.8:/data/www/pkl/<nama_project>/   # upload folder
```

Lebih nyaman pakai GUI: **WinSCP** atau **FileZilla** → protokol **SFTP**, host `10.8.242.8`, port `22`, user `pkl`. Drag & drop ke `/data/www/pkl/<nama_project>/`.

Tips: **jangan upload `node_modules/` atau `vendor/`** (besar & buang kuota disk). Upload source saja, lalu `npm install` / `composer install` di server.

Setelah login cek tools tersedia:
```bash
node -v    # v24.x
pm2 -v
php8.2 -v
```

## B.3 React — static build (paling gampang, tanpa port)

Kalau React murni frontend (atau backend terpisah), cukup build lalu upload hasilnya. Tanpa port, tanpa PM2.

1. App tampil di sub-path `/pkl/<nama_project>/`, set base path **sebelum build**:
   - **Vite** — `vite.config.js`:
     ```js
     export default defineConfig({
       base: '/pkl/<nama_project>/',
       // ...
     })
     ```
   - **Create React App** — `package.json`: `"homepage": "/pkl/<nama_project>"`
   - **React Router** — `<BrowserRouter basename="/pkl/<nama_project>">`, atau pakai `HashRouter` biar tak perlu konfigurasi server.
2. Build di laptop: `npm run build`
3. Upload **isi** folder `dist/` (Vite) atau `build/` (CRA) ke `/data/www/pkl/<nama_project>/`
4. Buka `http://10.8.242.8/pkl/<nama_project>/`

Kalau pakai `BrowserRouter` dan refresh di sub-halaman jadi 404 → minta pembimbing tambah `FallbackResource`, atau ganti `HashRouter`.

## B.4 Node/Express backend (butuh port + proxy)

1. Minta port ke pembimbing (misal dapat `5401`).
2. Port & bind dari env — jangan hardcode:
   ```js
   const port = process.env.PORT || 5401
   app.listen(port, '127.0.0.1', () => console.log(`listening on ${port}`))
   ```
3. Upload, install, jalankan dengan PM2:
   ```bash
   cd /data/www/pkl/<nama_project>
   npm install --omit=dev
   pm2 start server.js --name pkl-<nama_project>
   pm2 save
   ```
4. Lapor pembimbing → dibuatkan proxy `/pkl/<nama_project>/` → app-mu.

**Penting soal path**: proxy memotong prefix. Request pegawai ke `/pkl/<nama_project>/api/users` sampai di Express sebagai `/api/users`. Route Express ditulis biasa, tapi **semua URL di frontend harus relatif atau menyertakan prefix** (`fetch('api/users')` relatif, atau `fetch('/pkl/<nama_project>/api/users')`).

**Fullstack React + Express paling simpel** — serve build React dari Express, jadi cukup satu port & satu proxy:
```js
app.use(express.static('dist'))            // hasil npm run build (base: './')
app.get('*', (req, res) => res.sendFile(path.resolve('dist/index.html')))
```
Dengan pola ini set Vite `base: './'` (relatif) sudah cukup.

## B.5 Jangan pakai `npm run dev` sebagai "hosting"

`npm run dev` / dev server Vite itu untuk development di laptop. Di server pakai hasil build (B.3/B.4). Kalau butuh preview cepat: `vite preview --host 127.0.0.1 --port 54xx` via PM2 boleh, tapi bukan untuk jangka panjang.

## B.6 Laravel

Laravel dijalankan lewat `php8.2 artisan serve` + proxy (bukan via Apache). Kamu tetap dapat URL normal di `http://10.8.242.8/pkl/<nama_project>/`.

1. Minta ke pembimbing: **port** + **database** (nama DB, user, password).
2. Upload project (tanpa `vendor/`), lalu di server:
   ```bash
   cd /data/www/pkl/<nama_project>
   composer install
   cp .env.example .env
   nano .env
   ```
3. Isi `.env` minimal:
   ```ini
   APP_URL=http://10.8.242.8/pkl/<nama_project>
   ASSET_URL=http://10.8.242.8/pkl/<nama_project>
   DB_HOST=127.0.0.1
   DB_PORT=3306
   DB_DATABASE=pkl_<nama_project>
   DB_USERNAME=pkl_<nama_project>
   DB_PASSWORD=<dari pembimbing>
   ```
4. Inisialisasi & jalankan via PM2:
   ```bash
   php8.2 artisan key:generate
   php8.2 artisan migrate
   pm2 start "php8.2 artisan serve --host=127.0.0.1 --port=54xx" --name pkl-<nama_project>
   pm2 save
   ```
5. Lapor pembimbing untuk dibuatkan proxy.

Catatan sub-path: karena app hidup di `/pkl/<nama_project>/`, pakai helper Laravel (`route()`, `url()`, `asset()`) — jangan tulis `/login` mentah di Blade. Kalau URL hasil `route()` masih salah, tambahkan di `AppServiceProvider::boot()`:
```php
if (config('app.env') !== 'local') {
    \Illuminate\Support\Facades\URL::forceRootUrl(config('app.url'));
}
```
Catatan MySQL: driver default Laravel = `pdo_mysql` (tersedia). `mysqli` **tidak** tersedia — jangan pakai API mysqli langsung.

## B.7 MySQL/MariaDB

- Server DB: `127.0.0.1:3306`, MariaDB **10.3** (fitur SQL terbaru belum tentu ada — cek kalau error syntax).
- Akses CLI: `mysql -u pkl_<nama_project> -p pkl_<nama_project>`
- Kamu hanya bisa melihat & mengubah DB milik project-mu.
- Import dump: `mysql -u pkl_<nama_project> -p pkl_<nama_project> < dump.sql`

## B.8 PM2 cheatsheet

```bash
pm2 list                        # semua proses (punya teman juga kelihatan — jangan diusik)
pm2 logs pkl-<nama_project>     # lihat log & error
pm2 restart pkl-<nama_project>  # setelah upload kode baru
pm2 delete pkl-<nama_project>   # berhenti permanen
pm2 save                        # WAJIB setiap habis start/delete, biar hidup lagi pasca reboot
```

## B.9 Troubleshooting

| Gejala | Penyebab umum |
|---|---|
| `404 Not Found` di `/pkl/<project>/` | Proxy belum dibuat pembimbing, atau folder/`index.html` belum ada |
| `503 Service Unavailable` | App-mu mati — cek `pm2 list` & `pm2 logs` |
| Halaman putih, asset `.js`/`.css` 404 | Lupa set `base`/`homepage` ke `/pkl/<nama_project>/` sebelum build |
| Refresh di sub-halaman React → 404 | `BrowserRouter` tanpa `FallbackResource` — lihat B.3 |
| API kena 404 padahal backend hidup | Prefix path — lihat catatan di B.4 |
| `Permission denied` saat upload/edit | Kamu di luar `/data/www/pkl/` — memang sengaja dikunci |
| `EADDRINUSE` saat start | Port dipakai proses lain — cek `pm2 list`; jangan ganti port sendiri, lapor pembimbing |
| Bisa `curl 127.0.0.1:54xx` di server tapi tak bisa dari laptop | Normal — port tak dibuka keluar; akses lewat URL proxy |

---

Butuh port / database / proxy / reset → hubungi **pembimbing IT**.
