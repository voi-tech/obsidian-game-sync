export interface CsvTable {
	readonly headers: readonly string[];
	readonly rows: readonly (readonly string[])[];
}

export interface CsvParseError {
	readonly code: 'invalid-csv';
	readonly message: string;
}

export function parseCsv(input: string): CsvTable {
	const source = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
	const rows: string[][] = [];
	let row: string[] = [];
	let field = '';
	let quoted = false;

	for (let index = 0; index < source.length; index += 1) {
		const character = source[index];
		const next = source[index + 1];
		if (quoted) {
			if (character === '"' && next === '"') {
				field += '"';
				index += 1;
			} else if (character === '"') {
				quoted = false;
			} else {
				field += character;
			}
		} else if (character === '"' && field.length === 0) {
			quoted = true;
		} else if (character === ',') {
			row.push(field);
			field = '';
		} else if (character === '\n' || character === '\r') {
			if (character === '\r' && next === '\n') index += 1;
			row.push(field);
			if (row.some((value) => value.length > 0)) rows.push(row);
			row = [];
			field = '';
		} else {
			field += character;
		}
	}

	if (quoted) throw new Error('CSV contains an unterminated quoted field.');
	if (field.length > 0 || row.length > 0) {
		row.push(field);
		if (row.some((value) => value.length > 0)) rows.push(row);
	}
	const headers = rows.shift() ?? [];
	const duplicates = headers.filter((header, index) => headers.indexOf(header) !== index);
	if (headers.length === 0 || headers.some((header) => header.trim().length === 0)) throw new Error('CSV header is empty.');
	if (duplicates.length > 0) throw new Error(`CSV contains duplicate headers: ${[...new Set(duplicates)].join(', ')}.`);
	return { headers: headers.map((header) => header.trim()), rows };
}

export function tableRecords(table: CsvTable): readonly Readonly<Record<string, string>>[] {
	return table.rows.map((row) => Object.fromEntries(table.headers.map((header, index) => [header, row[index] ?? ''])));
}
