export class ProviderAuthError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = 'ProviderAuthError';
	}
}

export class ProviderNetworkError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = 'ProviderNetworkError';
	}
}

export class ProviderRateLimitError extends Error {
	readonly retryAfterMs?: number;

	constructor(message: string, retryAfterMs?: number, options?: ErrorOptions) {
		super(message, options);
		this.name = 'ProviderRateLimitError';
		this.retryAfterMs = retryAfterMs;
	}
}

export class ProviderSchemaError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = 'ProviderSchemaError';
	}
}

export class ProviderPartialError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = 'ProviderPartialError';
	}
}

export class VaultConflictError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = 'VaultConflictError';
	}
}

export class StateMigrationError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = 'StateMigrationError';
	}
}

export class ProviderHttpError extends Error {
	readonly status: number;

	constructor(message: string, status: number, options?: ErrorOptions) {
		super(message, options);
		this.name = 'ProviderHttpError';
		this.status = status;
	}
}
