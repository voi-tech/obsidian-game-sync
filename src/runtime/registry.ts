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
import { createSteamEnricher } from '../providers/steam/enricher';
import { createSteamLibraryProvider } from '../providers/steam/library-provider';
import { createPlayStationEnricher } from '../providers/playstation/enricher';
import { createPlayStationLibraryProvider } from '../providers/playstation/library-provider';
import { createSteamApi } from '../providers/steam/api';
import { createSteamAuth } from '../providers/steam/auth';
import { createCacheStore, sha256Fingerprint } from '../sync/cache';
import { SyncExecutor } from '../sync/executor';
import { createSyncPlanner, SyncPlanner } from '../sync/planner';
import { createSyncService, SyncService } from '../sync/service';
import { createEventHistory, EventHistory } from '../vault/history';
import { buildCanonicalManagedProperties, canonicalMappingFromLegacy, resolveCanonicalPropertyMapping } from '../vault/canonical-projection';
import { matchCanonicalVaultNote } from '../vault/matcher';
import { planCanonicalSync } from '../sync/canonical-planner';
import { CanonicalVaultWriter } from '../vault/canonical-writer';
import { CanonicalSyncService } from '../sync/canonical-service';
import { canonicalGameFingerprint } from '../sync/canonical-state';

export const GAME_SYNC_RUNTIME_REGISTRY = Object.freeze({
	marker: 'game-sync-vault-runtime',
	components: ['template-context', 'filename', 'property-mapping', 'canonical-projection', 'canonical-matcher', 'canonical-planner', 'canonical-writer', 'canonical-service', 'canonical-state', 'enrichment', 'achievement-renderer', 'managed-block', 'gateway', 'note-index', 'writer', 'provider', 'steam-api', 'steam-auth', 'steam-adapter', 'steam-enricher', 'playstation-api', 'playstation-auth', 'playstation-adapter', 'playstation-enricher', 'cache', 'executor', 'planner', 'sync-service', 'history'],
	buildTemplateContext,
	renderTemplate,
	renderFilename,
	buildManagedProperties,
	resolvePropertyMapping,
	buildCanonicalManagedProperties,
	canonicalMappingFromLegacy,
	resolveCanonicalPropertyMapping,
	matchCanonicalVaultNote,
	planCanonicalSync,
	CanonicalVaultWriter,
	CanonicalSyncService,
	canonicalGameFingerprint,
	renderAchievementsBlock,
	replaceAchievementsBlock,
	ObsidianVaultGateway,
	buildNoteIndex,
	VaultWriter,
	createSteamApi,
	createSteamAuth,
	createSteamAdapter,
	createSteamEnricher,
	createSteamLibraryProvider,
	createPlayStationApi,
	createPlayStationAuth,
	createPlayStationAdapter,
	createPlayStationEnricher,
	createPlayStationLibraryProvider,
	createCacheStore,
	sha256Fingerprint,
	SyncExecutor,
	SyncPlanner,
	createSyncPlanner,
	SyncService,
	createSyncService,
	EventHistory,
	createEventHistory,
});
