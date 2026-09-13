import { describe, expect, it, vi } from 'vitest';
import {
	COMMAND_ERROR_SIGNAL,
	registerGameSyncCommands,
	type CommandRegistrar,
	type GameSyncCommandActions,
} from '../src/runtime/commands';

const commandNamesAndIds = [
	['sync-all', 'Sync all'],
	['sync-steam', 'Sync Steam'],
	['sync-playstation', 'Sync PlayStation'],
	['preview-all-changes', 'Preview all changes'],
	['preview-steam-changes', 'Preview Steam changes'],
	['preview-playstation-changes', 'Preview PlayStation changes'],
	['review-pending-matches', 'Review pending matches'],
	['manage-game-matches', 'Manage game matches'],
	['manage-ignored-games', 'Manage ignored games'],
	['open-library-summary', 'Open library summary'],
	['force-refresh-all-data', 'Force refresh all data'],
	['copy-diagnostic-information', 'Copy diagnostic information'],
	['run-setup-wizard', 'Run setup wizard'],
] as const;

const actionNames = [
	'syncAll',
	'syncSteam',
	'syncPlayStation',
	'previewAllChanges',
	'previewSteamChanges',
	'previewPlayStationChanges',
	'reviewPendingMatches',
	'manageGameMatches',
	'manageIgnoredGames',
	'openLibrarySummary',
	'forceRefreshAllData',
	'copyDiagnosticInformation',
	'runSetupWizard',
] as const satisfies readonly (keyof GameSyncCommandActions)[];

type ActionSpy = ReturnType<typeof vi.fn<GameSyncCommandActions[keyof GameSyncCommandActions]>>;
type ActionSpies = { [Name in keyof GameSyncCommandActions]: ActionSpy };

function createActions(): { actions: ActionSpies; spies: ActionSpies } {
	const spies = Object.fromEntries(actionNames.map((name) => [name, vi.fn<GameSyncCommandActions[typeof name]>()])) as ActionSpies;
	return { actions: spies, spies };
}

function createRegistrar() {
	const commands: Parameters<CommandRegistrar['addCommand']>[0][] = [];
	const registrar: CommandRegistrar = {
		addCommand: (command) => { commands.push(command); },
	};
	return { commands, registrar };
}

describe('registerGameSyncCommands', () => {
	it('registers exactly the required command ids and names once', () => {
		const { commands, registrar } = createRegistrar();
		const { actions } = createActions();

		registerGameSyncCommands(registrar, actions);

		expect(commands).toHaveLength(13);
		expect(commands.map(({ id, name }) => [id, name])).toEqual(commandNamesAndIds);
		expect(new Set(commands.map(({ id }) => id)).size).toBe(13);
	});

	it('routes every command callback to its matching action', async () => {
		const { commands, registrar } = createRegistrar();
		const { actions, spies } = createActions();

		registerGameSyncCommands(registrar, actions);

		for (const [index, command] of commands.entries()) {
			await Promise.resolve(command.callback());
			expect(spies[actionNames[index]]).toHaveBeenCalledOnce();
		}
	});

	it('reports a static safe signal for thrown and rejected actions', async () => {
		const { commands, registrar } = createRegistrar();
		const { actions } = createActions();
		const onError = vi.fn();
		const sensitiveMessage = 'secret diagnostic details';

		actions.syncAll.mockImplementation(() => { throw new Error(sensitiveMessage); });
		actions.syncSteam.mockRejectedValue(new Error(sensitiveMessage));
		registerGameSyncCommands(registrar, actions, onError);

		await Promise.resolve(commands[0].callback());
		await Promise.resolve(commands[1].callback());
		await Promise.resolve();

		expect(onError).toHaveBeenCalledTimes(2);
		expect(onError).toHaveBeenNthCalledWith(1, COMMAND_ERROR_SIGNAL);
		expect(onError).toHaveBeenNthCalledWith(2, COMMAND_ERROR_SIGNAL);
		expect(JSON.stringify(onError.mock.calls)).not.toContain(sensitiveMessage);
	});
});
