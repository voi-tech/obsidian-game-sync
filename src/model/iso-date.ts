export type IsoDateInput = Date | number | string | null | undefined;

export interface IsoDateOptions {
	/** Unit used when a numeric value is supplied. Numbers are otherwise milliseconds since Unix epoch. */
	readonly numericEpoch?: 'milliseconds' | 'unix-seconds' | 'apple-seconds';
}

const ISO_DATE_PREFIX = /^(\d{4}-\d{2}-\d{2})(?:$|T|\s)/u;

function isValidCalendarDate(value: string): boolean {
	const [year, month, day] = value.split('-').map(Number);
	if (![year, month, day].every(Number.isInteger)) return false;
	const date = new Date(Date.UTC(year, month - 1, day));
	return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function localCalendarDate(date: Date): string {
	return [date.getFullYear(), date.getMonth() + 1, date.getDate()]
		.map((part, index) => index === 0 ? String(part).padStart(4, '0') : String(part).padStart(2, '0'))
		.join('-');
}

/**
 * Returns the calendar date represented by a date-like value without converting
 * an already-qualified source date through UTC first.
 */
export function toIsoDate(value: IsoDateInput, options: IsoDateOptions = {}): string | undefined {
	if (value === null || value === undefined || value === '') return undefined;
	if (typeof value === 'string') {
		const input = value.trim();
		if (input.length === 0) return undefined;
		const sourceDate = ISO_DATE_PREFIX.exec(input)?.[1];
		if (sourceDate !== undefined) return isValidCalendarDate(sourceDate) ? sourceDate : undefined;
		const parsed = new Date(input);
		return Number.isNaN(parsed.getTime()) ? undefined : localCalendarDate(parsed);
	}
	const milliseconds = typeof value === 'number'
		? options.numericEpoch === 'apple-seconds' ? 978307200000 + value * 1000
			: options.numericEpoch === 'unix-seconds' ? value * 1000 : value
		: value.getTime();
	const parsed = new Date(milliseconds);
	return Number.isNaN(parsed.getTime()) ? undefined : localCalendarDate(parsed);
}
