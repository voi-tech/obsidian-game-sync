import { describe, expect, it, vi } from 'vitest';
import { chooseGameTrackExportPath, getGameTrackExportDialogOptions } from '../src/providers/gametrack/csv/gametrack-csv-picker';

describe('GameTrack export picker boundary', () => {
	it('uses a single openFile ZIP dialog with a diagnostic all-files fallback', () => {
		expect(getGameTrackExportDialogOptions('/tmp/previous.zip')).toEqual({
			title: 'Choose GameTrack export',
			properties: ['openFile'],
			filters: [
				{ name: 'GameTrack export', extensions: ['zip'] },
				{ name: 'All files', extensions: ['*'] },
			],
			defaultPath: '/tmp/previous.zip',
			buttonLabel: 'Choose export',
		});
	});

	it('returns the selected path', async () => {
		const dialog = { showOpenDialog: vi.fn(async () => ({ canceled: false, filePaths: ['/test/gametrack.zip'] })) };

		expect(await chooseGameTrackExportPath(dialog)).toBe('/test/gametrack.zip');
		expect(dialog.showOpenDialog).toHaveBeenCalledWith(getGameTrackExportDialogOptions());
	});

	it('treats cancel and an empty result as no-op', async () => {
		const canceled = { showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })) };
		const empty = { showOpenDialog: vi.fn(async () => ({ canceled: false, filePaths: [] })) };

		expect(await chooseGameTrackExportPath(canceled)).toBeUndefined();
		expect(await chooseGameTrackExportPath(empty)).toBeUndefined();
	});

	it('reports the native result without exposing a full path', async () => {
		const dialog = { showOpenDialog: vi.fn(async () => ({ canceled: false, filePaths: ['/private/tmp/gametrack.zip'] })) };
		const observed: unknown[] = [];

		await chooseGameTrackExportPath(dialog, undefined, (result) => observed.push(result));

		expect(observed).toEqual([{ canceled: false, filePaths: 1, filename: 'gametrack.zip' }]);
	});
});
