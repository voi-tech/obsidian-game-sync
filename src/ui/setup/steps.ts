import type { GameSyncSettings } from '../../model/settings';

export const SETUP_STEP_IDS = [
	'welcome-privacy',
	'providers',
	'connections',
	'vault',
	'library-filters',
	'sync-behavior-history',
	'initial-fetch-preview',
] as const;

export type SetupStepId = (typeof SETUP_STEP_IDS)[number];

export type SetupResumeMode = 'setup' | 'initial-fetch-preview' | 'edit';

export interface SetupResume {
	mode: SetupResumeMode;
	step: SetupStepId;
}

export interface SetupStepValidation {
	hasProvider: boolean;
	templateValid: boolean;
}

export function nextSetupStep(step: SetupStepId): SetupStepId | undefined {
	const index = SETUP_STEP_IDS.indexOf(step);
	return index < 0 || index === SETUP_STEP_IDS.length - 1 ? undefined : SETUP_STEP_IDS[index + 1];
}

export function previousSetupStep(step: SetupStepId): SetupStepId | undefined {
	const index = SETUP_STEP_IDS.indexOf(step);
	return index <= 0 ? undefined : SETUP_STEP_IDS[index - 1];
}

export function canAdvanceSetupStep(step: SetupStepId, validation: SetupStepValidation): boolean {
	if (step === 'providers') return validation.hasProvider;
	if (step === 'vault') return validation.templateValid;
	return true;
}

export function getSetupResume(settings: Pick<GameSyncSettings, 'setupCompleted' | 'firstSyncCompleted'>): SetupResume {
	if (settings.setupCompleted && settings.firstSyncCompleted) return { mode: 'edit', step: SETUP_STEP_IDS[0] };
	if (settings.setupCompleted) return { mode: 'initial-fetch-preview', step: SETUP_STEP_IDS[6] };
	return { mode: 'setup', step: SETUP_STEP_IDS[0] };
}
