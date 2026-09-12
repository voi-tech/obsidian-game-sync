export type CanonicalGameId = string;
export type CanonicalIdFactory = () => string;

function fallbackUuid(): string {
	const time = Date.now().toString(16).padStart(12, '0');
	const random = `${Math.random().toString(16).slice(2)}${Math.random().toString(16).slice(2)}`.padEnd(20, '0').slice(0, 20);
	return `${time.slice(0, 8)}-${time.slice(8, 12)}-4${random.slice(0, 3)}-${(8 + (Number.parseInt(random[3] ?? '0', 16) % 4)).toString(16)}${random.slice(4, 7)}-${random.slice(7, 19)}`;
}

/** Creates a fresh canonical ID without deriving it from provider metadata. */
export function createCanonicalGameId(idFactory?: CanonicalIdFactory): CanonicalGameId {
	const webCrypto = typeof window !== 'undefined' ? window.crypto : typeof crypto !== 'undefined' ? crypto : undefined;
	const value = idFactory?.() ?? webCrypto?.randomUUID?.() ?? fallbackUuid();
	if (value.trim().length === 0) throw new Error('Canonical game ID factory returned an empty ID.');
	return value;
}
