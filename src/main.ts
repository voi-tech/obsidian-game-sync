import { Plugin } from 'obsidian';
import { GAME_SYNC_RUNTIME_REGISTRY } from './runtime/registry';

export { GAME_SYNC_RUNTIME_REGISTRY } from './runtime/registry';

export default class GameSyncPlugin extends Plugin {
	override async onload(): Promise<void> {
		void GAME_SYNC_RUNTIME_REGISTRY.marker;
		console.debug('[Game Sync] loaded');
	}

	override onunload(): void {
		console.debug('[Game Sync] unloaded');
	}
}
