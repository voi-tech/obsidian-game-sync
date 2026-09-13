# Changelog

## 26.9.0

Initial release scope:

- Steam library, metadata, playtime and achievements.
- Unofficial PlayStation library, playtime and trophy integration.
- SecretStorage-backed provider credentials and NPSSO bootstrap without NPSSO persistence.
- Canonical game identity, durable provider mappings and conservative vault matching.
- Preview-first synchronization with safe writes, adoption, conflict handling and recovery journal.
- Managed Properties, templates, achievements/trophies block and optional `Games.base`.
- English and Polish interface, setup wizard, settings, library summary and ignored-games manager.
- Desktop safe-only background sync with explicit interval and first-sync preview gates.
- Privacy-safe diagnostics, mobile bundle validation and fake-provider integration coverage.

Not included: provider write-back, purchase-history import, extra providers, custom backend, telemetry, multi-account vaults and a split/unmerge backend for the match-manager command.
