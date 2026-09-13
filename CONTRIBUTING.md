# Contributing to Game Sync

Contributions are welcome when they preserve the plugin’s privacy and safety contract.

## Before changing code

- Read `docs/specs/game-sync-26.9.0.md`.
- Keep synchronization one-way: provider → Obsidian.
- Preserve manual note body, unmanaged frontmatter and existing note files.
- Do not add telemetry, a Game Sync backend, write-back or hidden credential storage.
- Treat PlayStation integration as unofficial and isolate provider-specific behavior.

## Local development

Requirements: Node.js `>=20.19.0`.

```bash
npm ci
npm run check
npm run dev
```

Use fake providers and local fixtures for tests. Do not put real Steam API keys, NPSSO values, access tokens or refresh tokens in the repository, test fixtures or issue logs.

## Pull requests

Describe the user-visible behavior, affected provider and privacy implications. Add or update tests for changed behavior. Run `npm run check` before opening a pull request and include the result.

Do not include generated credentials, vault contents or private account identifiers in patches, screenshots or logs.

## Releases

Versions use `YY.M.PATCH`, for example `26.9.0`. A release must pass the release check and include only the generated production assets required by the plugin.

## License

By contributing, you agree that your contribution is provided under the project’s [MIT License](LICENSE).
