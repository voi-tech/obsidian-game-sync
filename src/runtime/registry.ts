import { buildManagedProperties, resolvePropertyMapping } from '../model/property-mapping';
import { ObsidianVaultGateway } from '../vault/gateway';
import { renderAchievementsBlock } from '../vault/achievement-renderer';
import { replaceAchievementsBlock } from '../vault/managed-block';
import { buildNoteIndex } from '../vault/note-index';
import { buildTemplateContext, renderFilename, renderTemplate } from '../vault/template';
import { VaultWriter } from '../vault/writer';
import { createPlayStationAdapter } from '../providers/playstation/adapter';
import { createPlayStationApi } from '../providers/playstation/api';
import { createPlayStationAuth } from '../providers/playstation/auth';
import { createSteamAdapter } from '../providers/steam/adapter';
import { createSteamApi } from '../providers/steam/api';
import { createSteamAuth } from '../providers/steam/auth';

export const GAME_SYNC_RUNTIME_REGISTRY = Object.freeze({
	marker: 'game-sync-vault-runtime',
	components: ['template-context', 'filename', 'property-mapping', 'achievement-renderer', 'managed-block', 'gateway', 'note-index', 'writer', 'provider', 'steam-api', 'steam-auth', 'steam-adapter', 'playstation-api', 'playstation-auth', 'playstation-adapter'],
	buildTemplateContext,
	renderTemplate,
	renderFilename,
	buildManagedProperties,
	resolvePropertyMapping,
	renderAchievementsBlock,
	replaceAchievementsBlock,
	ObsidianVaultGateway,
	buildNoteIndex,
	VaultWriter,
	createSteamApi,
	createSteamAuth,
	createSteamAdapter,
	createPlayStationApi,
	createPlayStationAuth,
	createPlayStationAdapter,
});
