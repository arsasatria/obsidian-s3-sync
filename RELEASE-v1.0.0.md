# S3 Sync v1.0.0

This is the initial public release of `S3 Sync`, an Obsidian plugin for synchronizing vaults with `S3-compatible` object storage.

## Highlights

- Manual `Push`, `Pull`, `Sync`, and `Undo` workflows
- Bidirectional synchronization with three-way diff planning
- Manual `Push` now force-replaces S3 with the current local vault state
- Manual `Pull` now force-replaces the local vault with the latest S3 state
- Last manual `Push` or `Pull` can be rolled back with `Undo`
- Conflict handling with `keep-local`, `keep-remote`, `keep-both`, and `ask-user`
- Incremental synchronization based on vault changes
- Scheduled sync, startup sync, and sync on save
- Near-realtime remote polling
- In-app Live Sync Monitor and Sync Log
- Mobile safe mode for Android and iOS
- Safe boot mode to pause background automation after repeated failures
- ASCII-safe remote key encoding for paths with emoji or other non-ASCII characters
- Smart text compression and safety snapshots

## Platform Notes

- Desktop support: `Windows`, `macOS`, and `Linux`
- Mobile support: `Android`
- `iOS` and `iPadOS` may require additional validation depending on the storage provider and filesystem behavior

## Installation

Copy the following files into:

```text
<VAULT>/.obsidian/plugins/obsidian-s3-sync/
```

Required files:

- `main.js`
- `manifest.json`
- `styles.css`

Then enable the plugin from `Settings -> Community plugins`.

For detailed installation steps, see [INSTALL-OBSIDIAN.md](./INSTALL-OBSIDIAN.md).

## Validation

The release was validated with:

- `npm test`
- `npm run lint`
- `npm run build`

## Notes

- For many self-hosted S3-compatible services such as MinIO, `Force path style` should remain enabled.
- `Region` is optional and may be left blank for many S3-compatible providers.
- It is recommended to test the plugin in a disposable vault before using it in a primary vault.
- Manual `Push` and `Pull` are source-of-truth replacement actions and should be used intentionally.
