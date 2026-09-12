const SECRET_FIELD_PATTERN = /(?:access[_-]?token|refresh[_-]?token|api[_-]?key|authorization|npsso|password|secret)/i;
const BEARER_PATTERN = /Bearer\s+[A-Za-z0-9._~+/=-]+/gi;
const NPSSO_PATTERN = /(?:npsso\s*[:=]\s*)[^\s,;)}]+/gi;
const STANDALONE_NPSSO_PATTERN = /(^|[^A-Za-z0-9_-])([A-Za-z0-9_-]{64})(?=$|[^A-Za-z0-9_-])/g;
const REDACTED = '[REDACTED]';

function redactString(value: string, secrets: readonly string[], includeStandaloneNpsso: boolean): string {
	let sanitized = value
		.replace(BEARER_PATTERN, `Bearer ${REDACTED}`)
		.replace(NPSSO_PATTERN, `npsso=${REDACTED}`);
	if (includeStandaloneNpsso) {
		sanitized = sanitized.replace(STANDALONE_NPSSO_PATTERN, `$1${REDACTED}`);
	}
	for (const secret of secrets) {
		if (secret.length > 0) {
			sanitized = sanitized.split(secret).join(REDACTED);
		}
	}
	return sanitized;
}

function sanitizeValue(value: unknown, secrets: readonly string[], seen: WeakSet<object>, includeStandaloneNpsso: boolean): unknown {
	if (typeof value === 'string') {
		return redactString(value, secrets, includeStandaloneNpsso);
	}
	if (value === null || typeof value !== 'object') {
		return value;
	}
	if (seen.has(value)) {
		return REDACTED;
	}
	seen.add(value);
	if (Array.isArray(value)) {
		return value.map((item) => sanitizeValue(item, secrets, seen, includeStandaloneNpsso));
	}
	const result: Record<string, unknown> = {};
	for (const [key, nested] of Object.entries(value)) {
		result[key] = SECRET_FIELD_PATTERN.test(key) ? REDACTED : sanitizeValue(nested, secrets, seen, includeStandaloneNpsso);
	}
	return result;
}

function sanitizePersistedStateValue(value: unknown, secrets: readonly string[], seen: WeakSet<object>): unknown {
	if (typeof value === 'string') {
		return redactString(value, secrets, false);
	}
	if (value === null || typeof value !== 'object') {
		return value;
	}
	if (seen.has(value)) {
		return REDACTED;
	}
	seen.add(value);
	if (Array.isArray(value)) {
		return value.map((item) => sanitizePersistedStateValue(item, secrets, seen));
	}
	const result: Record<string, unknown> = {};
	for (const [key, nested] of Object.entries(value)) {
		if (SECRET_FIELD_PATTERN.test(key)) {
			result[key] = REDACTED;
		} else if (key === 'recentActivity' && Array.isArray(nested)) {
			result[key] = nested.map((entry) => sanitizeActivityEntry(entry, secrets, seen));
		} else {
			result[key] = sanitizePersistedStateValue(nested, secrets, seen);
		}
	}
	return result;
}

function sanitizeActivityEntry(value: unknown, secrets: readonly string[], seen: WeakSet<object>): unknown {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		return sanitizePersistedStateValue(value, secrets, seen);
	}
	if (seen.has(value)) {
		return REDACTED;
	}
	seen.add(value);
	const result: Record<string, unknown> = {};
	for (const [key, nested] of Object.entries(value)) {
		if (SECRET_FIELD_PATTERN.test(key)) {
			result[key] = REDACTED;
		} else {
			result[key] = sanitizeValue(nested, secrets, seen, key === 'message');
		}
	}
	return result;
}

export function sanitizeError(error: unknown, secrets: readonly string[] = []): string {
	if (error instanceof Error) {
		return redactString(`${error.name}: ${error.message}${error.stack ? `\n${error.stack}` : ''}`, secrets, true);
	}
	return redactString(String(error), secrets, true);
}

export function sanitizeDiagnosticData<T>(data: T, secrets: readonly string[] = []): T {
	return sanitizeValue(data, secrets, new WeakSet<object>(), true) as T;
}

export function sanitizePersistedState<T>(data: T, secrets: readonly string[] = []): T {
	return sanitizePersistedStateValue(data, secrets, new WeakSet<object>()) as T;
}
