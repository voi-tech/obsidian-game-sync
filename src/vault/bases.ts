import { resolvePropertyMapping, type PropertyMapping, type ResolvedPropertyMapping } from '../model/property-mapping';
import type { VaultGateway } from './gateway';

export const DEFAULT_GAMES_BASE_PATH = 'Games.base';

export interface GamesBaseOptions {
	path?: string;
	basePath?: string;
	propertyMapping?: PropertyMapping;
}

export interface GamesBaseResult {
	path: string;
	created: boolean;
}

interface BaseView {
	name: string;
	filters?: readonly string[];
	sort?: { property: string; direction: 'ASC' | 'DESC' };
}

function yamlString(value: string): string {
	return `'${value.replaceAll("'", "''")}'`;
}

function propertyReference(property: string | undefined): string | undefined {
	return property === undefined ? undefined : `note[${JSON.stringify(property)}]`;
}

function comparison(property: string | undefined, operator: string, value: string): string | undefined {
	const reference = propertyReference(property);
	return reference === undefined ? undefined : `${reference} ${operator} ${value}`;
}

function gameTypeFilter(mapping: ResolvedPropertyMapping): string | undefined {
	return comparison(mapping.type, '==', JSON.stringify('game'));
}

function withGameType(mapping: ResolvedPropertyMapping, filters: readonly (string | undefined)[] = []): string[] {
	return [gameTypeFilter(mapping), ...filters].filter((filter): filter is string => filter !== undefined);
}

function viewLines(view: BaseView): string[] {
	const lines = [`  - type: table`, `    name: ${view.name}`];
	if (view.filters !== undefined && view.filters.length > 0) {
		lines.push('    filters:', '      and:');
		for (const filter of view.filters) lines.push(`        - ${yamlString(filter)}`);
	}
	if (view.sort !== undefined) {
		lines.push('    sort:', `      - property: ${yamlString(view.sort.property)}`, `        direction: ${view.sort.direction}`);
	}
	lines.push('    order:', '      - file.name');
	return lines;
}

function buildViews(mapping: ResolvedPropertyMapping): BaseView[] {
	const lastPlayed = propertyReference(mapping.lastPlayed);
	const playtime = propertyReference(mapping.playtime);
	return [
		{ name: 'All games', filters: withGameType(mapping) },
		{
			name: 'Recently played',
			filters: withGameType(mapping, [comparison(mapping.lastPlayed, '!=', 'null')]),
			sort: lastPlayed === undefined ? undefined : { property: lastPlayed, direction: 'DESC' },
		},
		{
			name: 'Most played',
			filters: withGameType(mapping),
			sort: playtime === undefined ? undefined : { property: playtime, direction: 'DESC' },
		},
		{ name: 'Steam', filters: withGameType(mapping, [comparison(mapping.steamId, '!=', 'null')]) },
		{ name: 'PlayStation', filters: withGameType(mapping, [comparison(mapping.playstationId, '!=', 'null')]) },
		{
			name: 'Never played',
			filters: withGameType(mapping, [comparison(mapping.playtime, '==', '0'), comparison(mapping.lastPlayed, '==', 'null')]),
		},
		{
			name: 'Steam 100%',
			filters: withGameType(mapping, [comparison(mapping.steamAchievementsProgress, '==', '100')]),
		},
		{
			name: 'PlayStation platinum',
			filters: withGameType(mapping, [comparison(mapping.psnPlatinum, '>', '0')]),
		},
	];
}

export function renderGamesBase(propertyMapping: PropertyMapping = {}): string {
	const mapping = resolvePropertyMapping(propertyMapping);
	const lines = ['views:'];
	for (const view of buildViews(mapping)) lines.push(...viewLines(view));
	return `${lines.join('\n')}\n`;
}

export async function createGamesBase(gateway: VaultGateway, options: GamesBaseOptions = {}): Promise<GamesBaseResult> {
	const path = options.path ?? options.basePath ?? DEFAULT_GAMES_BASE_PATH;
	if (path.trim().length === 0) throw new Error('Games.base path must not be empty.');
	if (await gateway.exists(path)) return { path, created: false };
	await gateway.create(path, renderGamesBase(options.propertyMapping));
	return { path, created: true };
}

export const generateGamesBase = createGamesBase;
