# Obsidian S3 Sync

Plugin Obsidian untuk sinkronisasi vault ke penyimpanan `S3-compatible` seperti AWS S3, MinIO, Cloudflare R2, dan Backblaze B2.

Plugin ini dirancang untuk kolaborasi lintas perangkat dengan fokus pada:

- sinkronisasi dua arah yang reliabel
- three-way diff untuk deteksi perubahan
- conflict handling yang aman
- pengalaman operasional yang jelas lewat log, monitor, dan dry run

## Highlights

- `Push`, `Fetch`, dan `Sync` manual
- Bidirectional sync dengan three-way diff
- Incremental sync berbasis event vault
- Sync on save, startup sync, scheduled sync
- Near-realtime remote polling
- Exclude patterns dan opsi sync folder `.obsidian`
- Dry run preview sebelum eksekusi
- Conflict rules: `keep-local`, `keep-remote`, `keep-both`, `ask-user`
- Live Sync Monitor dan Sync Log di dalam Obsidian
- Mobile safe mode untuk Android/iOS
- Safe boot mode untuk mencegah UI terkunci saat background sync gagal berulang
- ASCII-safe remote key encoding untuk path dengan emoji atau karakter non-ASCII
- Smart text compression dan safety snapshots

## Push, Fetch, Sync

- `Push`: kirim perubahan lokal ke S3. Cocok saat device ini adalah sumber perubahan terbaru.
- `Fetch`: ambil perubahan dari S3 ke lokal. Cocok saat Anda ingin menarik update dari device lain.
- `Sync`: sinkronisasi dua arah penuh. Plugin membandingkan `local`, `last-sync`, dan `remote`, lalu menentukan upload, download, delete, atau conflict handling.

Panduan cepat:

- selesai menulis di device ini: pakai `Push`
- baru buka device lain: pakai `Fetch`
- pemakaian normal harian: pakai `Sync`

## Platform Support

- `Windows`, `macOS`, `Linux`: supported
- `Android`: supported dengan `Mobile safe mode`
- `iOS`, `iPadOS`: perlu validasi lebih lanjut pada setup nyata

## LTS Baseline

Repo ini dipin untuk baseline jangka panjang:

- `Node.js 24.14.1 LTS`
- `npm 11.11.0`

File terkait:

- [`package.json`](./package.json)
- [`.nvmrc`](./.nvmrc)
- [`.node-version`](./.node-version)

Jika memakai `nvm`:

```bash
nvm use
```

## Development

Install dependency:

```bash
npm install
```

Jalankan dev build:

```bash
npm run dev
```

Build production:

```bash
npm run build
```

## Quality Checks

Jalankan test:

```bash
npm test
```

Jalankan coverage:

```bash
npm run test:coverage
```

Jalankan lint:

```bash
npm run lint
```

Status verifikasi terbaru repo ini:

- test lulus
- lint lulus
- build lulus

## Install ke Obsidian

File hasil build yang dipakai untuk instalasi manual:

- `main.js`
- `manifest.json`
- `styles.css`

Langkah ringkas:

1. Jalankan `npm run build`
2. Salin `main.js`, `manifest.json`, dan `styles.css`
3. Tempatkan ke:

```text
<VAULT>/.obsidian/plugins/obsidian-s3-sync/
```

4. Aktifkan dari `Settings -> Community plugins`

Panduan detail:

- [INSTALL-OBSIDIAN.md](./INSTALL-OBSIDIAN.md)

## Repo Guide

- [CHANGELOG.md](./CHANGELOG.md)
- [PUBLISH-CHECKLIST.md](./PUBLISH-CHECKLIST.md)
- [PRD-ObsidianS3SyncPlugin.md](./PRD-ObsidianS3SyncPlugin.md)

Struktur penting:

- [`src/main.ts`](./src/main.ts): entry point plugin
- [`src/sync/orchestrator.ts`](./src/sync/orchestrator.ts): orkestrasi sync utama
- [`src/sync/differ.ts`](./src/sync/differ.ts): three-way diff engine
- [`src/s3/store.ts`](./src/s3/store.ts): operasi S3-compatible
- [`src/settings/tab.ts`](./src/settings/tab.ts): settings UI
- [`src/ui/monitor-view.ts`](./src/ui/monitor-view.ts): live monitor
- [`tests`](./tests): unit dan integration tests

## Operational Notes

- Gunakan vault dummy saat pengujian awal.
- Backup vault sebelum sync pertama.
- Untuk MinIO dan banyak self-hosted S3, aktifkan `Force path style`.
- Untuk maintenance, hindari upgrade dependency tanpa rerun `npm test`, `npm run lint`, dan `npm run build`.
