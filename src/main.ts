import { Plugin } from 'obsidian';

export default class GameSyncPlugin extends Plugin {
	override async onload(): Promise<void> {
		console.debug('[Game Sync] loaded');
	}

	override onunload(): void {
		console.debug('[Game Sync] unloaded');
	}
}
