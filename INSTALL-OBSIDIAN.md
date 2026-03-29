# Instalasi Plugin S3 Sync ke Obsidian

Dokumen ini menjelaskan cara memasang plugin `S3 Sync` secara manual ke Obsidian.

## Prasyarat

- Obsidian Desktop atau Mobile dengan Community Plugins aktif
- Folder vault Obsidian yang sudah bisa dibuka normal
- Artefak plugin hasil build:
  - `main.js`
  - `manifest.json`
  - `styles.css`

## Lokasi File Plugin

Plugin Obsidian manual dipasang di folder:

```text
<VAULT>/.obsidian/plugins/obsidian-s3-sync/
```

Contoh di Windows:

```text
C:\Users\nama-anda\Documents\MyVault\.obsidian\plugins\obsidian-s3-sync\
```

## Langkah Instalasi Manual

1. Tutup Obsidian, atau minimal tutup vault target terlebih dahulu.
2. Pastikan folder plugin ini sudah dibuild dan menghasilkan `main.js`, `manifest.json`, dan `styles.css`.
3. Buka folder vault Anda.
4. Masuk ke folder `.obsidian/plugins/`.
5. Buat folder baru bernama `obsidian-s3-sync`.
6. Salin file berikut ke dalam folder tersebut:

```text
main.js
manifest.json
styles.css
```

Hasil akhirnya harus seperti ini:

```text
<VAULT>/.obsidian/plugins/obsidian-s3-sync/main.js
<VAULT>/.obsidian/plugins/obsidian-s3-sync/manifest.json
<VAULT>/.obsidian/plugins/obsidian-s3-sync/styles.css
```

7. Buka kembali Obsidian.
8. Masuk ke `Settings -> Community plugins`.
9. Pastikan `Restricted mode` sudah nonaktif.
10. Aktifkan plugin `S3 Sync`.

## Konfigurasi Awal

Setelah plugin aktif:

1. Buka `Settings -> S3 Sync`.
2. Isi parameter koneksi:
   - `Endpoint URL`
   - `Bucket name`
   - `Region` (opsional, bisa dikosongkan untuk banyak layanan S3-compatible)
   - `Access key ID`
   - `Secret access key`
   - `Prefix` bila perlu
3. Untuk MinIO, biarkan `Force path style` tetap aktif.
4. Tekan `Test connection`.
5. Jika koneksi sukses, jalankan `Push`, `Fetch`, atau `Run full sync now` dari Command Palette atau tombol manual plugin.

## Upgrade Versi Plugin

Jika ingin memperbarui plugin:

1. Nonaktifkan plugin `S3 Sync` di Obsidian.
2. Ganti file `main.js`, `manifest.json`, dan `styles.css` dengan versi baru.
3. Buka kembali Obsidian atau reload aplikasi.
4. Aktifkan lagi pluginnya bila perlu.

## Build Ulang dari Source

Jika Anda ingin build sendiri dari source repo ini:

```bash
npm install
npm run build
```

Untuk proyek ini, baseline runtime yang direkomendasikan adalah `Node.js 24.14.1 LTS`.

## Troubleshooting Singkat

### Plugin tidak muncul di daftar

- Pastikan folder plugin bernama tepat `obsidian-s3-sync`
- Pastikan file `manifest.json` ada di folder plugin
- Pastikan `Restricted mode` dimatikan

### Plugin gagal aktif

- Periksa apakah `main.js` hasil build terbaru
- Pastikan `manifest.json` dan `styles.css` ikut diperbarui bersama `main.js`
- Buka `Developer Console` Obsidian untuk melihat error runtime

### Koneksi S3 gagal

- Pastikan endpoint, bucket, dan kredensial benar
- Untuk MinIO atau layanan self-hosted, cek `Force path style`
- Pastikan koneksi menggunakan HTTPS bila server Anda mengharuskannya

## Catatan Keamanan

- Uji dulu plugin di vault dummy sebelum dipakai di vault utama
- Simpan backup vault sebelum sync pertama
- Jangan membagikan `Access key ID` dan `Secret access key`
