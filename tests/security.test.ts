import { describe, expect, it } from 'vitest';
import {
	GAME_SYNC_SECRET_NAMES,
	createSecretStore,
	type SecretStorageLike,
} from '../src/auth/secrets';
import { sanitizeDiagnosticData, sanitizeError } from '../src/auth/sanitize';

const secrets = [
	'STEAM_TEST_SECRET_123',
	'NPSSO_TEST_SECRET_456',
	'ACCESS_TEST_SECRET_789',
	'REFRESH_TEST_SECRET_012',
];

describe('secret storage and sanitization', () => {
	it('stores only namespaced plugin-owned secret references', () => {
		const values = new Map<string, string>();
		const storage: SecretStorageLike = {
			getSecret: (name) => values.get(name) ?? null,
			setSecret: (name, value) => void values.set(name, value),
			deleteSecret: (name) => void values.delete(name),
		};
		const store = createSecretStore(storage);

		store.set('steam-api-key', secrets[0]);

		expect([...values.keys()]).toEqual([GAME_SYNC_SECRET_NAMES.steamApiKey]);
		expect(store.get('steam-api-key')).toBe(secrets[0]);
		store.delete('steam-api-key');
		expect(store.get('steam-api-key')).toBeNull();
	});

	it('redacts registered values and bearer or NPSSO-shaped values from errors', () => {
		const error = new Error(
			`Authorization: Bearer ${secrets[2]} npsso=${secrets[1]} key=${secrets[0]}`,
		);
		const sanitized = sanitizeError(error, secrets);

		expect(sanitized).not.toContain(secrets[0]);
		expect(sanitized).not.toContain(secrets[1]);
		expect(sanitized).not.toContain(secrets[2]);
		expect(sanitized).toContain('[REDACTED]');
	});

	it('redacts diagnostic payloads and activity entries recursively', () => {
		const payload = {
			activity: {
				message: `refreshToken=${secrets[3]}`,
			},
			credentials: {
				accessToken: secrets[2],
				npsso: secrets[1],
			},
		};
		const sanitized = sanitizeDiagnosticData(payload, secrets);

		expect(JSON.stringify(sanitized)).not.toContain('TEST_SECRET');
		expect(sanitized.credentials).toEqual({
			accessToken: '[REDACTED]',
			npsso: '[REDACTED]',
		});
	});
});
