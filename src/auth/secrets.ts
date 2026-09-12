import type { SecretStorage } from 'obsidian';

export interface SecretStorageLike {
	getSecret(name: string): string | null;
	setSecret(name: string, value: string): void;
	deleteSecret?: (name: string) => void;
}

export const GAME_SYNC_SECRET_NAMES = {
	steamApiKey: 'game-sync-steam-api-key',
	psnAccessToken: 'game-sync-psn-access-token',
	psnRefreshToken: 'game-sync-psn-refresh-token',
} as const;

type SecretName = 'steam-api-key' | 'psn-access-token' | 'psn-refresh-token';

const SECRET_NAME_MAP: Record<SecretName, string> = {
	'steam-api-key': GAME_SYNC_SECRET_NAMES.steamApiKey,
	'psn-access-token': GAME_SYNC_SECRET_NAMES.psnAccessToken,
	'psn-refresh-token': GAME_SYNC_SECRET_NAMES.psnRefreshToken,
};

export function isNpssoValue(value: string): boolean {
	return /^[A-Za-z0-9_-]{64}$/.test(value);
}

function ownedSecretName(name: string): string {
	if (name.toLowerCase().includes('npsso')) {
		throw new Error('NPSSO must never be stored in SecretStorage.');
	}
	if (Object.prototype.hasOwnProperty.call(SECRET_NAME_MAP, name)) {
		return SECRET_NAME_MAP[name as SecretName];
	}
	if (name === GAME_SYNC_SECRET_NAMES.steamApiKey || name === GAME_SYNC_SECRET_NAMES.psnAccessToken || name === GAME_SYNC_SECRET_NAMES.psnRefreshToken) {
		return name;
	}
	throw new Error(`Unsupported Game Sync secret name: ${name}.`);
}

export interface SecretStore {
	get(name: string): string | null;
	set(name: string, value: string): void;
	delete(name: string): void;
}

export function createSecretStore(storage: SecretStorageLike): SecretStore {
	return {
		get(name: string): string | null {
			const value = storage.getSecret(ownedSecretName(name));
			return value === null || value.length === 0 ? null : value;
		},
		set(name: string, value: string): void {
			if (value.length === 0 || isNpssoValue(value)) {
				throw new Error('Secret value is empty or NPSSO-shaped and cannot be stored.');
			}
			storage.setSecret(ownedSecretName(name), value);
		},
		delete(name: string): void {
			const secretName = ownedSecretName(name);
			if (storage.deleteSecret !== undefined) {
				storage.deleteSecret(secretName);
				return;
			}
			storage.setSecret(secretName, '');
		},
	};
}

export function createObsidianSecretStore(storage: SecretStorage): SecretStore {
	return createSecretStore({
		getSecret: (name) => storage.getSecret(name),
		setSecret: (name, value) => storage.setSecret(name, value),
		deleteSecret: undefined,
	});
}
