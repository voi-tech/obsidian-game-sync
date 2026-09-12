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

function ownedSecretName(name: string): string {
	if (name in SECRET_NAME_MAP) {
		return SECRET_NAME_MAP[name as SecretName];
	}
	if (name.startsWith('game-sync-')) {
		return name;
	}
	return `game-sync-${name}`;
}

export interface SecretStore {
	get(name: string): string | null;
	set(name: string, value: string): void;
	delete(name: string): void;
}

export function createSecretStore(storage: SecretStorageLike): SecretStore {
	return {
		get(name: string): string | null {
			return storage.getSecret(ownedSecretName(name));
		},
		set(name: string, value: string): void {
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
