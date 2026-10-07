import { Notice, type SettingDefinitionGroup, type SettingDefinitionPage } from 'obsidian';
import { t } from '../../i18n';
import { TEMPLATE_KEY_CATALOG, type TemplateKeyInfo } from '../../vault/template-reference';

type TemplateKeyGroupId = 'game' | 'steam' | 'playstation' | 'purchase' | 'blocks';

export interface TemplateKeyRow {
	id: string;
	group: TemplateKeyGroupId;
	snippet: string;
	label: string;
	example?: string;
}

const GROUP_ORDER: readonly TemplateKeyGroupId[] = ['game', 'steam', 'playstation', 'purchase', 'blocks'];
const ARRAY_KEYS = new Set<string>(['developers', 'publishers', 'genres', 'platforms', 'providers']);
const PARTIAL_KEYS = new Set<string>(['steamAchievements', 'playstationTrophies']);

function groupFor(key: string): TemplateKeyGroupId {
	if (PARTIAL_KEYS.has(key)) return 'blocks';
	if (key.startsWith('steam')) return 'steam';
	if (key.startsWith('playstation') || key.startsWith('psn')) return 'playstation';
	if (key.startsWith('purchase')) return 'purchase';
	return 'game';
}

/** The text a user pastes into a template: arrays are joined and object lists use their ready-made partial. */
export function templateSnippet(key: string): string {
	if (PARTIAL_KEYS.has(key)) return `{{> ${key}}}`;
	if (ARRAY_KEYS.has(key)) return `{{join ${key}}}`;
	return `{{${key}}}`;
}

function label(entry: TemplateKeyInfo, polish: boolean): string {
	return (polish ? entry.description.pl : entry.description.en).replace(/\.$/u, '');
}

export function templateKeyRows(polish: boolean): TemplateKeyRow[] {
	const rows: TemplateKeyRow[] = TEMPLATE_KEY_CATALOG.map((entry) => ({
		id: entry.key,
		group: groupFor(entry.key),
		snippet: templateSnippet(entry.key),
		label: label(entry, polish),
		...(PARTIAL_KEYS.has(entry.key) ? {} : { example: entry.example }),
	}));
	rows.push({ id: 'achievements', group: 'blocks', snippet: '{{> achievements}}', label: t('settings.templateKeys.achievementsPartial') });
	return rows;
}

export async function copyTemplateSnippet(snippet: string): Promise<void> {
	try {
		const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
		if (clipboard?.writeText === undefined) throw new Error('Clipboard unavailable');
		await clipboard.writeText(snippet);
		new Notice(t('settings.templateKeys.copied', { snippet }));
	} catch {
		new Notice(t('settings.templateKeys.copyFailed'));
	}
}

function rowDescription(row: TemplateKeyRow): DocumentFragment {
	return createFragment((fragment) => {
		fragment.createEl('code', { text: row.snippet });
		if (row.example !== undefined) fragment.appendText(` · ${t('settings.templateKeys.example', { example: row.example })}`);
	});
}

/**
 * Native sub-page listing every template key. Each row is a declarative action:
 * clicking it copies a ready-to-paste snippet. Rows are indexed by the settings search.
 */
export function templateKeyPage(polish: boolean): SettingDefinitionPage {
	const rows = templateKeyRows(polish);
	const groups = GROUP_ORDER.map((groupId): SettingDefinitionGroup => ({
		type: 'group',
		heading: t(`settings.templateKeys.groups.${groupId}`),
		items: rows.filter((row) => row.group === groupId).map((row) => ({
			name: row.label,
			desc: rowDescription(row),
			aliases: [row.id, row.snippet],
			action: () => void copyTemplateSnippet(row.snippet),
		})),
	}));
	return {
		type: 'page',
		name: t('settings.templateKeys.heading'),
		desc: t('settings.templateKeys.pageDescription'),
		items: [
			{ type: 'group', items: [{ name: t('settings.templateKeys.howTo'), desc: t('settings.templateKeys.description'), searchable: false }] },
			...groups,
		],
	};
}
