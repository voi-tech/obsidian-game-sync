export type CommandCallback = () => void;

export interface CommandRegistrar {
	addCommand(command: {
		id: string;
		name: string;
		callback: CommandCallback;
	}): void;
}

export type GameSyncCommandAction = () => void | PromiseLike<void>;

export interface GameSyncCommandActions {
	syncAll: GameSyncCommandAction;
	previewAllChanges: GameSyncCommandAction;
	reviewPendingMatches: GameSyncCommandAction;
	manageGameMatches: GameSyncCommandAction;
	manageIgnoredGames: GameSyncCommandAction;
	openLibrarySummary: GameSyncCommandAction;
	forceRefreshAllData: GameSyncCommandAction;
	copyDiagnosticInformation: GameSyncCommandAction;
	runSetupWizard: GameSyncCommandAction;
}

export const COMMAND_ERROR_SIGNAL = 'command-failed' as const;
export type CommandErrorSignal = typeof COMMAND_ERROR_SIGNAL;
export type CommandErrorHandler = (signal: CommandErrorSignal) => void;

type CommandActionName = keyof GameSyncCommandActions;
type CommandDefinition = {
	id: string;
	name: string;
	action: CommandActionName;
};

const COMMAND_DEFINITIONS: readonly CommandDefinition[] = [
	{ id: 'sync-all', name: 'Sync games', action: 'syncAll' },
	{ id: 'preview-all-changes', name: 'Preview sync', action: 'previewAllChanges' },
	{ id: 'review-pending-matches', name: 'Review pending matches', action: 'reviewPendingMatches' },
	{ id: 'manage-game-matches', name: 'Manage game matches', action: 'manageGameMatches' },
	{ id: 'manage-ignored-games', name: 'Manage ignored games', action: 'manageIgnoredGames' },
	{ id: 'open-library-summary', name: 'Open library summary', action: 'openLibrarySummary' },
	{ id: 'force-refresh-all-data', name: 'Force refresh all data', action: 'forceRefreshAllData' },
	{ id: 'copy-diagnostic-information', name: 'Copy diagnostic information', action: 'copyDiagnosticInformation' },
	{ id: 'run-setup-wizard', name: 'Open Quick Setup', action: 'runSetupWizard' },
];

function reportCommandError(onError: CommandErrorHandler | undefined): void {
	try {
		onError?.(COMMAND_ERROR_SIGNAL);
	} catch {
		// Error handlers must not create an unhandled rejection either.
	}
}

function createCommandCallback(action: GameSyncCommandAction, onError: CommandErrorHandler | undefined): CommandCallback {
	return () => {
		try {
			void Promise.resolve(action()).catch(() => { reportCommandError(onError); });
		} catch {
			reportCommandError(onError);
		}
	};
}

export function registerGameSyncCommands(
	registrar: CommandRegistrar,
	actions: GameSyncCommandActions,
	onError?: CommandErrorHandler,
): void {
	for (const definition of COMMAND_DEFINITIONS) {
		registrar.addCommand({
			id: definition.id,
			name: definition.name,
			callback: createCommandCallback(actions[definition.action], onError),
		});
	}
}
