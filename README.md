# Obsidian S3 Sync

An Obsidian plugin for synchronizing vaults with `S3-compatible` object storage such as AWS S3, MinIO, Cloudflare R2, and Backblaze B2.

This plugin is designed for cross-device collaboration with a focus on:

- reliable bidirectional synchronization
- three-way diff-based change detection
- safe conflict handling
- clear operational visibility through logs, monitoring, and dry runs

## Highlights

- Manual `Push`, `Pull`, `Sync`, and `Undo` actions
- Bidirectional synchronization with three-way diff
- Incremental sync based on vault events
- Sync on save, startup sync, and scheduled sync
- Near-realtime remote polling
- Exclude patterns and optional `.obsidian` synchronization
- Dry-run preview before execution
- Conflict rules: `keep-local`, `keep-remote`, `keep-both`, `ask-user`
- Live Sync Monitor and Sync Log inside Obsidian
- Mobile safe mode for Android and iOS
- Safe boot mode to prevent the UI from becoming unusable after repeated background sync failures
- ASCII-safe remote key encoding for paths containing emoji or other non-ASCII characters
- Smart text compression, safety snapshots, and manual-action rollback backups

## Push, Pull, Sync, Undo

- `Push`: force-pushes the current local vault state to S3. Files that exist only on S3 are removed so the bucket matches the current device.
- `Pull`: force-pulls the latest S3 state into the local vault. Files that exist only locally are removed so the vault matches S3.
- `Sync`: performs a full bidirectional synchronization. The plugin compares `local`, `last-sync`, and `remote` state to determine uploads, downloads, deletions, and conflict handling.
- `Undo`: restores the last manual `Push` or `Pull` by replaying rollback data captured before the force action started.

Recommended usage:

- after finishing work on the current device: use `Push`
- when opening the vault on another device and treating S3 as the source of truth: use `Pull`
- for normal day-to-day operation: use `Sync`
- if a manual `Push` or `Pull` was started by mistake: use `Undo`

Important safety note:

- Manual `Push` and `Pull` always open a preview first and can be cancelled before any overwrite or delete occurs.
- Rollback data for the last manual force action is kept in `.s3sync-actions/**` and is excluded from sync.

## Platform Support

- `Windows`, `macOS`, `Linux`: supported
- `Android`: supported with `Mobile safe mode`
- `iOS`, `iPadOS`: require additional validation on real-world setups

## LTS Baseline

This repository is pinned to a long-term support baseline:

- `Node.js 24.14.1 LTS`
- `npm 11.11.0`

Related files:

- [`package.json`](./package.json)
- [`.nvmrc`](./.nvmrc)
- [`.node-version`](./.node-version)

If you use `nvm`:

```bash
nvm use
```

## Development

Install dependencies:

```bash
npm install
```

Run the development build:

```bash
npm run dev
```

Create a production build:

```bash
npm run build
```

## Quality Checks

Run the test suite:

```bash
npm test
```

Run coverage:

```bash
npm run test:coverage
```

Run linting:

```bash
npm run lint
```

Current verification status:

- tests pass
- lint passes
- build passes

## Installation

Build artifacts required for manual installation:

- `main.js`
- `manifest.json`
- `styles.css`

Quick steps:

1. Run `npm run build`
2. Copy `main.js`, `manifest.json`, and `styles.css`
3. Place them in:

```text
<VAULT>/.obsidian/plugins/obsidian-s3-sync/
```

4. Enable the plugin from `Settings -> Community plugins`

Detailed instructions:

- [INSTALL-OBSIDIAN.md](./INSTALL-OBSIDIAN.md)

## Repo Guide

- [CHANGELOG.md](./CHANGELOG.md)
- [PUBLISH-CHECKLIST.md](./PUBLISH-CHECKLIST.md)

Key project files:

- [`src/main.ts`](./src/main.ts): plugin entry point
- [`src/sync/orchestrator.ts`](./src/sync/orchestrator.ts): core sync orchestration
- [`src/sync/differ.ts`](./src/sync/differ.ts): three-way diff engine
- [`src/s3/store.ts`](./src/s3/store.ts): S3-compatible storage operations
- [`src/settings/tab.ts`](./src/settings/tab.ts): settings UI
- [`src/ui/monitor-view.ts`](./src/ui/monitor-view.ts): live monitor view
- [`tests`](./tests): unit and integration tests

## Operational Notes

- Use a disposable test vault during initial validation.
- Back up the vault before the first sync.
- For MinIO and many self-hosted S3 services, keep `Force path style` enabled.
- Treat manual `Push` and `Pull` as source-of-truth operations.
- For long-term maintenance, avoid upgrading dependencies without rerunning `npm test`, `npm run lint`, and `npm run build`.
