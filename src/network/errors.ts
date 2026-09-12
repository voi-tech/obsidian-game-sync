export interface ProviderErrorOptions extends ErrorOptions {
	status?: number;
	retryable?: boolean;
}

export class ProviderAuthError extends Error {
	readonly status?: number;
	readonly retryable = false;

	constructor(message: string, options?: ProviderErrorOptions) {
		super(message, options);
		this.name = 'ProviderAuthError';
		this.status = options?.status;
	}
}

export class ProviderNetworkError extends Error {
	readonly status?: number;
	readonly retryable: boolean;

	constructor(message: string, options?: ProviderErrorOptions) {
		super(message, options);
		this.name = 'ProviderNetworkError';
		this.status = options?.status;
		this.retryable = options?.retryable ?? (this.status === undefined || this.status === 502 || this.status === 503 || this.status === 504);
	}
}

export class ProviderRateLimitError extends Error {
	readonly retryAfterMs?: number;
	readonly status = 429;
	readonly retryable = true;

	constructor(message: string, retryAfterMs?: number, options?: ProviderErrorOptions) {
		super(message, options);
		this.name = 'ProviderRateLimitError';
		this.retryAfterMs = retryAfterMs;
	}
}

export class ProviderSchemaError extends Error {
	readonly retryable = false;

	constructor(message: string, options?: ProviderErrorOptions) {
		super(message, options);
		this.name = 'ProviderSchemaError';
	}
}

export class ProviderPartialError extends Error {
	readonly retryable = false;

	constructor(message: string, options?: ProviderErrorOptions) {
		super(message, options);
		this.name = 'ProviderPartialError';
	}
}

export class VaultConflictError extends Error {
	readonly retryable = false;

	constructor(message: string, options?: ProviderErrorOptions) {
		super(message, options);
		this.name = 'VaultConflictError';
	}
}

export class StateMigrationError extends Error {
	readonly retryable = false;

	constructor(message: string, options?: ProviderErrorOptions) {
		super(message, options);
		this.name = 'StateMigrationError';
	}
}

export class ProviderHttpError extends Error {
	readonly status: number;
	readonly retryable = false;

	constructor(message: string, status: number, options?: ProviderErrorOptions) {
		super(message, options);
		this.name = 'ProviderHttpError';
		this.status = status;
	}
}
