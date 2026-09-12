export async function mapWithLimit<T, R>(
	values: readonly T[],
	limit: number,
	mapper: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
	if (!Number.isInteger(limit) || limit < 1) {
		throw new RangeError('Concurrency limit must be a positive integer.');
	}
	const results = new Array<R>(values.length);
	let nextIndex = 0;
	const worker = async (): Promise<void> => {
		while (nextIndex < values.length) {
			const index = nextIndex;
			nextIndex += 1;
			results[index] = await mapper(values[index], index);
		}
	};
	const workers = Array.from({ length: Math.min(limit, values.length) }, () => worker());
	await Promise.all(workers);
	return results;
}
