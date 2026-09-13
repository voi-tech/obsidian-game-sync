import { describe, expect, it } from 'vitest';
import {
	ACTIVITY_KINDS,
	MAX_RECENT_ACTIVITY,
	RecentActivityLog,
	appendRecentActivity,
	listRecentActivity,
	type RecentActivityEntry,
} from '../src/diagnostics/activity';
import { buildDiagnosticReport, type DiagnosticReportInput } from '../src/diagnostics/report';

function activityEntry(index: number, kind: RecentActivityEntry['kind'] = 'sync-success'): RecentActivityEntry {
	return {
		id: `activity-${index}`,
		createdAt: `2026-09-13T12:${String(index).padStart(2, '0')}:00.000Z`,
		kind,
		message: `Activity ${index}`,
		data: { index, nested: { value: index } },
	};
}

describe('recent activity diagnostics', () => {
	it('keeps the newest 50 entries in chronological order without mutating inputs', () => {
		const input = Array.from({ length: MAX_RECENT_ACTIVITY + 5 }, (_, index) => activityEntry(index + 1));
		const appended = appendRecentActivity(input, activityEntry(56, 'sync-partial'));

		expect(input).toHaveLength(55);
		expect(appended).toHaveLength(MAX_RECENT_ACTIVITY);
		expect(appended.map((entry) => entry.id)).toEqual(Array.from({ length: 50 }, (_, index) => `activity-${index + 7}`));
		expect(appended.at(-1)).toMatchObject({ id: 'activity-56', kind: 'sync-partial' });

		if (input[54]?.data !== undefined) input[54].data.nested = { value: 'changed outside the log' };
		expect(appended.at(-2)?.data).toEqual({ index: 55, nested: { value: 55 } });
	});

	it('lists defensive copies and supports every activity kind', () => {
		const log = new RecentActivityLog();
		for (const [index, kind] of ACTIVITY_KINDS.entries()) log.append(activityEntry(index + 1, kind));

		const listed = listRecentActivity(log.list());
		expect(listed.map((entry) => entry.kind)).toEqual([...ACTIVITY_KINDS]);
		if (listed[0]?.data !== undefined) listed[0].data.nested = { value: 'changed in the returned list' };
		expect(log.list()[0]?.data).toEqual({ index: 1, nested: { value: 1 } });
	});
});

describe('diagnostic report', () => {
	it('contains only the allowlisted diagnostic fields and redacts sensitive or raw payloads', () => {
		const secrets = ['STEAM_TEST_SECRET', 'NPSSO_TEST_SECRET', 'ACCESS_TEST_SECRET', 'REFRESH_TEST_SECRET'];
		const input: DiagnosticReportInput = {
			gameSyncVersion: '26.9.0',
			obsidianVersion: '1.13.7',
			os: 'macOS',
			platform: 'desktop',
			providers: {
				steam: { enabled: true, status: 'connected' },
				playstation: { enabled: false, status: 'disconnected' },
			},
			lastSyncState: 'partial',
			stateSchemaVersion: 1,
			cacheSchemaVersion: 1,
			lastError: new Error(`raw provider error: ${secrets[2]} and api response body`),
			noteContent: 'PRIVATE_NOTE_CONTENT',
			apiResponse: { body: 'FULL_API_RESPONSE', refreshToken: secrets[3] },
		};

		const report = buildDiagnosticReport(input, secrets);

		expect(report).toContain('Game Sync version: 26.9.0');
		expect(report).toContain('Obsidian version: 1.13.7');
		expect(report).toContain('OS/platform: macOS / desktop');
		expect(report).toContain('steam: enabled=true; status=connected');
		expect(report).toContain('playstation: enabled=false; status=disconnected');
		expect(report).toContain('Last sync state: partial');
		expect(report).toContain('State schema version: 1');
		expect(report).toContain('Cache schema version: 1');
		for (const value of [...secrets, 'PRIVATE_NOTE_CONTENT', 'FULL_API_RESPONSE', 'raw provider error']) {
			expect(report).not.toContain(value);
		}
	});
});
