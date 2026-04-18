# Changelog

## 1.0.0

- Initial release of `Obsidian S3 Sync`.
- Added manual `Push`, `Pull`, `Sync`, and `Undo` workflows.
- Added three-way diff sync planning with conflict handling.
- Changed manual `Push` to force local state to S3 with rollback support.
- Changed manual `Pull` to force remote S3 state to the local vault with rollback support.
- Added rollback capture for the last manual force action.
- Added internal mutation guards so overwrite/delete actions do not immediately requeue unsafe incremental sync work.
- Added live monitor, sync log, ribbon actions, and settings tab.
- Added near-realtime polling, startup sync, and sync-on-save.
- Added mobile-safe mode for Android/iOS.
- Added safe boot mode to pause background automation after repeated startup/background failures.
- Added debug logging toggle for low-level scan, queue, and manifest activity.
- Added ASCII-safe remote key encoding so emoji and non-ASCII paths remain normal on-device while using safer S3 object keys.
- Added storage optimizations such as smart text compression and safety snapshot retention.
- Added desktop/mobile transport fallbacks for broader S3-compatible support.
