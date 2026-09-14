export interface GameTrackExportDialogOptions {
	readonly title: string;
	readonly properties: readonly ['openFile'];
	readonly filters: readonly {
		readonly name: string;
		readonly extensions: readonly string[];
	}[];
	readonly defaultPath?: string;
	readonly buttonLabel?: string;
}

export interface GameTrackExportDialogResult {
	readonly canceled: boolean;
	readonly filePaths: readonly string[];
}

export interface GameTrackExportPickerObservation {
	readonly canceled: boolean;
	readonly filePaths: number;
	readonly filename?: string;
}

export interface GameTrackExportDialog {
	showOpenDialog(options: GameTrackExportDialogOptions): Promise<GameTrackExportDialogResult>;
}

export function getGameTrackExportDialogOptions(defaultPath?: string): GameTrackExportDialogOptions {
	return {
		title: 'Choose GameTrack export',
		properties: ['openFile'],
		filters: [
			{ name: 'GameTrack export', extensions: ['zip'] },
			{ name: 'All files', extensions: ['*'] },
		],
		...(defaultPath === undefined ? {} : { defaultPath }),
		buttonLabel: 'Choose export',
	};
}

export async function chooseGameTrackExportPath(
	dialog: GameTrackExportDialog,
	defaultPath?: string,
	onResult?: (observation: GameTrackExportPickerObservation) => void,
): Promise<string | undefined> {
	const result = await dialog.showOpenDialog(getGameTrackExportDialogOptions(defaultPath));
	onResult?.({
		canceled: result.canceled,
		filePaths: result.filePaths.length,
		...(result.filePaths[0] === undefined ? {} : { filename: result.filePaths[0].split(/[\\/]/u).at(-1) }),
	});
	if (result.canceled || result.filePaths.length === 0) return undefined;
	return result.filePaths[0];
}
