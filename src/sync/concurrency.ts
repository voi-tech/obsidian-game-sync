export type SyncExclusiveRunner = <T>(operation: () => Promise<T>) => Promise<T>;

/** Serializes manual and scheduled sync work without coupling the lock to a provider. */
export function createSyncConcurrencyGuard(): SyncExclusiveRunner {
	let tail = Promise.resolve();
	return <T>(operation: () => Promise<T>): Promise<T> => {
		const previous = tail;
		let release!: () => void;
		tail = new Promise<void>((resolve) => { release = resolve; });
		return previous.then(operation).finally(release);
	};
}
