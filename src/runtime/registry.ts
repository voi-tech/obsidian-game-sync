import { buildManagedProperties, resolvePropertyMapping } from '../model/property-mapping';
import { ObsidianVaultGateway } from '../vault/gateway';
import { renderAchievementsBlock } from '../vault/achievement-renderer';
import { replaceAchievementsBlock } from '../vault/managed-block';
import { buildNoteIndex } from '../vault/note-index';
import { buildTemplateContext, renderFilename, renderTemplate } from '../vault/template';
import { VaultWriter } from '../vault/writer';

export const GAME_SYNC_RUNTIME_REGISTRY = Object.freeze({
	marker: 'game-sync-vault-runtime',
	components: ['template-context', 'filename', 'property-mapping', 'achievement-renderer', 'managed-block', 'gateway', 'note-index', 'writer'],
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
});
