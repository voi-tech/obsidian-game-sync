import type { GameProviderCapabilities, HostPlatform } from '../../model/canonical-provider';

export interface NormalizedPlatform {
	readonly id: string;
	readonly known: boolean;
	readonly rawName: string;
}

const PLATFORM_IDS: Readonly<Record<string, string>> = {
	android: 'android',
	'3ds': 'nintendo-3ds',
	ios: 'ios',
	linux: 'linux',
	mac: 'macos',
	pc: 'pc',
	ps3: 'playstation-3',
	ps4: 'playstation-4',
	ps5: 'playstation-5',
	stadia: 'stadia',
	steam: 'steam',
	switch: 'nintendo-switch',
	'win phone': 'windows-phone',
	wiiu: 'wii-u',
	vita: 'playstation-vita',
	x360: 'xbox-360',
	xone: 'xbox-one',
	'series x': 'xbox-series',
};

export function normalizePlatform(rawName: string): NormalizedPlatform {
	const trimmed = rawName.trim();
	const key = trimmed.toLocaleLowerCase('en-US');
	const id = PLATFORM_IDS[key] ?? (key.replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '') || 'unknown');
	return { id, known: PLATFORM_IDS[key] !== undefined, rawName: trimmed };
}

const UNSUPPORTED: GameProviderCapabilities = {
	supported: false, desktop: false, mobile: false, automaticSync: false, library: false, metadata: false,
	platforms: false, playtime: false, achievementSummary: false,
};

const MACOS_DESKTOP: GameProviderCapabilities = {
	supported: true, desktop: true, mobile: false, automaticSync: true, library: true, metadata: true, platforms: true,
	playtime: true, achievementSummary: true,
};

export function getGameTrackCapabilities(platform: HostPlatform): GameProviderCapabilities {
	return platform === 'macos' ? MACOS_DESKTOP : UNSUPPORTED;
}
