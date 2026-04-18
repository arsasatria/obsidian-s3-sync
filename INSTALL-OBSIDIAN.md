# Installing the S3 Sync Plugin in Obsidian

This document explains how to install the `S3 Sync` plugin manually in Obsidian.

## Prerequisites

- Obsidian Desktop or Mobile with Community Plugins enabled
- An Obsidian vault that opens normally
- Built plugin artifacts:
  - `main.js`
  - `manifest.json`
  - `styles.css`

## Plugin Directory

Manually installed Obsidian plugins must be placed in:

```text
<VAULT>/.obsidian/plugins/obsidian-s3-sync/
```

Example on Windows:

```text
C:\Users\your-name\Documents\MyVault\.obsidian\plugins\obsidian-s3-sync\
```

## Manual Installation Steps

1. Close Obsidian, or at minimum close the target vault.
2. Ensure the plugin has been built and that `main.js`, `manifest.json`, and `styles.css` are present.
3. Open your vault folder.
4. Navigate to `.obsidian/plugins/`.
5. Create a new folder named `obsidian-s3-sync`.
6. Copy the following files into that folder:

```text
main.js
manifest.json
styles.css
```

The final structure should look like this:

```text
<VAULT>/.obsidian/plugins/obsidian-s3-sync/main.js
<VAULT>/.obsidian/plugins/obsidian-s3-sync/manifest.json
<VAULT>/.obsidian/plugins/obsidian-s3-sync/styles.css
```

7. Reopen Obsidian.
8. Go to `Settings -> Community plugins`.
9. Ensure `Restricted mode` is disabled.
10. Enable the `S3 Sync` plugin.

## Initial Configuration

After the plugin is enabled:

1. Open `Settings -> S3 Sync`.
2. Fill in the connection settings:
   - `Endpoint URL`
   - `Bucket name`
   - `Region` (optional; it may be left blank for many S3-compatible services)
   - `Access key ID`
   - `Secret access key`
   - `Prefix`, if needed
3. For MinIO, keep `Force path style` enabled.
4. Click `Test connection`.
5. Once the connection succeeds, run `Push`, `Pull`, or `Run full sync now` from the Command Palette or the plugin's manual action buttons.
6. Use `Push` only when the current device should replace the S3 copy, and use `Pull` only when S3 should replace the local vault.
7. If you trigger a manual `Push` or `Pull` by mistake, use `Undo last force push/pull` immediately.

## Updating the Plugin

To update the plugin:

1. Disable the `S3 Sync` plugin in Obsidian.
2. Replace `main.js`, `manifest.json`, and `styles.css` with the new versions.
3. Reopen Obsidian or reload the application.
4. Re-enable the plugin if necessary.

## Building from Source

If you want to build the plugin from source:

```bash
npm install
npm run build
```

For this project, the recommended runtime baseline is `Node.js 24.14.1 LTS`.

## Troubleshooting

### The plugin does not appear in the list

- Ensure the plugin folder is named exactly `obsidian-s3-sync`
- Ensure `manifest.json` is present in the plugin folder
- Ensure `Restricted mode` is disabled

### The plugin fails to load

- Verify that `main.js` is the latest build
- Ensure `manifest.json` and `styles.css` were updated together with `main.js`
- Open the Obsidian `Developer Console` to inspect runtime errors

### The S3 connection fails

- Ensure the endpoint, bucket, and credentials are correct
- For MinIO or self-hosted services, verify `Force path style`
- Ensure the connection uses HTTPS if your server requires it

## Security Notes

- Test the plugin in a disposable vault before using it in a primary vault
- Keep a backup of the vault before the first sync
- Treat manual `Push` and `Pull` as source-of-truth replacement operations
- Do not share your `Access key ID` or `Secret access key`
