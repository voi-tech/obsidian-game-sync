import { describe, expect, it } from 'vitest';
import { FakeVaultGateway } from './fake-gateway';
import { createGamesBase, renderGamesBase } from '../src/vault/bases';

describe('Games.base bootstrap', () => {
	it('renders the required native views from managed properties', () => {
		const content = renderGamesBase();

		expect(content).toMatchInlineSnapshot(`
			"views:
			  - type: table
			    name: All games
			    filters:
			      and:
			        - 'note["type"] == "game"'
			    order:
			      - file.name
			  - type: table
			    name: Recently played
			    filters:
			      and:
			        - 'note["type"] == "game"'
			        - 'note["last-played"] != null'
			    sort:
			      - property: 'note["last-played"]'
			        direction: DESC
			    order:
			      - file.name
			  - type: table
			    name: Most played
			    filters:
			      and:
			        - 'note["type"] == "game"'
			    sort:
			      - property: 'note["playtime"]'
			        direction: DESC
			    order:
			      - file.name
			  - type: table
			    name: Steam
			    filters:
			      and:
			        - 'note["type"] == "game"'
			        - 'note["steam-id"] != null'
			    order:
			      - file.name
			  - type: table
			    name: PlayStation
			    filters:
			      and:
			        - 'note["type"] == "game"'
			        - 'note["playstation-id"] != null'
			    order:
			      - file.name
			  - type: table
			    name: Never played
			    filters:
			      and:
			        - 'note["type"] == "game"'
			        - 'note["playtime"] == 0'
			        - 'note["last-played"] == null'
			    order:
			      - file.name
			  - type: table
			    name: Steam 100%
			    filters:
			      and:
			        - 'note["type"] == "game"'
			        - 'note["steam-achievements-progress"] == 100'
			    order:
			      - file.name
			  - type: table
			    name: PlayStation platinum
			    filters:
			      and:
			        - 'note["type"] == "game"'
			        - 'note["psn-platinum"] > 0'
			    order:
			      - file.name
			"
		`);
		expect(content).toContain('name: All games');
		expect(content).toContain('name: Recently played');
		expect(content).toContain('name: Most played');
		expect(content).toContain('name: Steam');
		expect(content).toContain('name: PlayStation');
		expect(content).toContain('name: Never played');
		expect(content).toContain('name: Steam 100%');
		expect(content).toContain('name: PlayStation platinum');
		expect(content).not.toMatch(/Playing|Backlog|Completed/);
		expect(content).not.toContain('file.inFolder');
	});

	it('creates only on explicit invocation and does not overwrite an existing target', async () => {
		const gateway = new FakeVaultGateway();
		expect(await createGamesBase(gateway)).toEqual({ path: 'Games.base', created: true });
		expect(await gateway.read('Games.base')).toBe(renderGamesBase());

		const existing = new FakeVaultGateway({ 'Games.base': 'user-owned base' });
		expect(await createGamesBase(existing)).toEqual({ path: 'Games.base', created: false });
		expect(await existing.read('Games.base')).toBe('user-owned base');
	});

	it('uses mapped managed properties rather than folder or fixed property names', () => {
		const content = renderGamesBase({
			type: 'kind',
			playtime: 'minutes-played',
			lastPlayed: 'last-session',
			steamId: 'steam-app',
			playstationId: 'psn-concept',
			steamAchievementsProgress: 'steam-completion',
			psnPlatinum: 'platinum-trophies',
		});

		expect(content).toContain('note["kind"] == "game"');
		expect(content).toContain('property: \'note["minutes-played"]\'');
		expect(content).toContain('note["last-session"] != null');
		expect(content).toContain('note["steam-app"] != null');
		expect(content).toContain('note["psn-concept"] != null');
		expect(content).toContain('note["steam-completion"] == 100');
		expect(content).toContain('note["platinum-trophies"] > 0');
		expect(content).not.toContain('note["type"]');
	});
});
