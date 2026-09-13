# Security

Game Sync handles provider credentials and account data locally. Please help keep reports safe.

## Never disclose secrets

Never include any of the following in a public GitHub issue, pull request, screenshot, diagnostic report or test fixture:

- a real Steam API key;
- an NPSSO value;
- a PSN access token;
- a PSN refresh token.

Also remove full vault exports, note bodies and private account identifiers before sharing diagnostics.

## Reporting a suspected exposure

Do not publish a suspected credential or token exposure in a public issue. Contact the maintainer privately through the repository owner’s GitHub profile and include only the minimum reproducible security details. Revoke or rotate the affected provider credential first when possible.

## Security model

- Steam and PlayStation requests are made directly to provider services.
- Credentials use Obsidian SecretStorage.
- NPSSO is used only for PlayStation bootstrap and is not retained.
- Diagnostic output is allowlisted and excludes secrets, provider responses and note contents.
- Existing Markdown data is not deleted when a provider is disconnected or unavailable.
