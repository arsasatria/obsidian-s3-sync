# Publish Checklist

## Repo Hygiene

- Confirm `README.md`, `INSTALL-OBSIDIAN.md`, and `CHANGELOG.md` are up to date.
- Confirm `.gitignore` excludes `node_modules`, `coverage`, and local scratch files.
- Confirm no credentials, tokens, or endpoint secrets are present in committed files or screenshots.
- Confirm `manifest.json` fields are final: `id`, `name`, `version`, `minAppVersion`, `description`, and author metadata.
- Confirm all user-facing Markdown documentation is written in formal English.

## Quality Gates

- Run `npm install`.
- Run `npm test`.
- Run `npm run lint`.
- Run `npm run build`.
- Smoke-test the generated `main.js`, `manifest.json`, and `styles.css` in a clean Obsidian vault.

## Manual Verification

- Test `Push`, `Fetch`, and `Sync` from the command palette and ribbon.
- Test file create, edit, rename, move, and delete.
- Test folder create, rename, move, and delete.
- Test `.obsidian` sync on and off.
- Test conflict handling for `keep-local`, `keep-remote`, and `keep-both`.
- Test safe boot by simulating repeated automatic sync failures.
- Test mobile-safe mode on Android before claiming mobile support broadly.

## Release Artifacts

- Build fresh release artifacts: `main.js`, `manifest.json`, `styles.css`.
- Tag the release version in Git.
- Prepare a release note summarizing user-facing changes and known limitations.

## Community Plugin Submission

- Verify the repo is public and has a clear license.
- Verify installation instructions are easy to follow.
- Verify screenshots or GIFs reflect the current UI.
- Double-check that support statements for `Windows`, `macOS`, `Linux`, `Android`, `iOS`, and `iPadOS` match actual testing status.
