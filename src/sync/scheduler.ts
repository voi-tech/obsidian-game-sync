import type { Component } from 'obsidian';
import { isSupportedBackgroundIntervalMinutes, type BackgroundNotifications, type GameSyncSettings } from '../model/settings';
import type { PreparedSync, SyncApplyResult } from './service';

export interface BackgroundSyncService {
	prepareAll(): Promise<PreparedSync>;
	applySelection(
		prepared: PreparedSync,
		selectedOperationIds: readonly string[],
		options: { background: true },
	): Promise<SyncApplyResult>;
}

export interface BackgroundSyncSchedulerOptions {
	component: Pick<Component, 'registerInterval'>;
	isMobile: () => boolean;
	readSettings: () => GameSyncSettings | Promise<GameSyncSettings>;
	service: BackgroundSyncService;
	timer: Pick<Window, 'setInterval' | 'clearInterval'>;
	notify?: (message: string) => void;
}

export type BackgroundSyncSchedulerState = 'stopped' | 'scheduled' | 'running';

type TimerHandle = number;
type NotificationKind = 'completed' | 'prepare-failed' | 'apply-failed' | 'problems';

const NOTIFICATION_MESSAGES: Record<NotificationKind, string> = {
	completed: 'Game Sync: background sync completed.',
	'prepare-failed': 'Game Sync: background sync failed while preparing data.',
	'apply-failed': 'Game Sync: background sync failed while applying changes.',
	problems: 'Game Sync: background sync completed with items requiring attention.',
};

function uniqueIds(ids: readonly string[]): string[] {
	return [...new Set(ids)];
}

export class BackgroundSyncScheduler {
	private readonly component: Pick<Component, 'registerInterval'>;
	private readonly isMobile: () => boolean;
	private readonly readSettings: () => GameSyncSettings | Promise<GameSyncSettings>;
	private readonly service: BackgroundSyncService;
	private readonly timerApi: Pick<Window, 'setInterval' | 'clearInterval'>;
	private readonly notify: (message: string) => void;
	private started = false;
	private timer?: TimerHandle;
	private configurationRevision = 0;
	private running?: Promise<void>;
	private pendingOperationIds: string[] = [];

	constructor(options: BackgroundSyncSchedulerOptions) {
		this.component = options.component;
		this.isMobile = options.isMobile;
		this.readSettings = options.readSettings;
		this.service = options.service;
		this.timerApi = options.timer;
		this.notify = options.notify ?? (() => undefined);
	}

	async start(): Promise<void> {
		if (this.started) return;
		this.started = true;
		await this.configure();
	}

	stop(): void {
		this.started = false;
		this.configurationRevision += 1;
		this.clearTimer();
	}

	async refresh(): Promise<void> {
		this.started = true;
		await this.configure();
	}

	run(): Promise<void> {
		if (this.running !== undefined) return this.running;
		const run = this.executeRun()
			.catch(() => {
				this.emit('problems', 'problems-only', true);
			})
			.finally(() => {
				if (this.running === run) this.running = undefined;
			});
		this.running = run;
		return run;
	}

	getPending(): readonly string[] {
		return [...this.pendingOperationIds];
	}

	getState(): BackgroundSyncSchedulerState {
		if (!this.started) return 'stopped';
		if (this.running !== undefined) return 'running';
		return this.timer === undefined ? 'stopped' : 'scheduled';
	}

	private async configure(): Promise<void> {
		const revision = ++this.configurationRevision;
		this.clearTimer();
		if (!this.started || this.isMobile()) return;

		let settings: GameSyncSettings;
		try {
			settings = await this.readSettings();
		} catch {
			this.emit('prepare-failed', 'problems-only', true);
			return;
		}
		if (revision !== this.configurationRevision || !this.started || this.isMobile()) return;
		if (!settings.backgroundSync || !isSupportedBackgroundIntervalMinutes(settings.backgroundIntervalMinutes)) return;

		const intervalMs = settings.backgroundIntervalMinutes * 60 * 1000;
		let timer: number | undefined;
		try {
			timer = this.timerApi.setInterval(() => { void this.run(); }, intervalMs);
			this.timer = this.component.registerInterval(timer);
		} catch {
			if (timer !== undefined) this.timerApi.clearInterval(timer);
			if (this.timer !== undefined) this.timerApi.clearInterval(this.timer);
			this.timer = undefined;
			this.emit('prepare-failed', settings.backgroundNotifications, true);
		}
	}

	private clearTimer(): void {
		if (this.timer === undefined) return;
		this.timerApi.clearInterval(this.timer);
		this.timer = undefined;
	}

	private async executeRun(): Promise<void> {
		if (this.isMobile()) return;

		let settings: GameSyncSettings;
		try {
			settings = await this.readSettings();
		} catch {
			this.emit('prepare-failed', 'problems-only', true);
			return;
		}
		if (!settings.backgroundSync || !isSupportedBackgroundIntervalMinutes(settings.backgroundIntervalMinutes)) return;

		let prepared: PreparedSync;
		try {
			prepared = await this.service.prepareAll();
		} catch {
			this.emit('prepare-failed', settings.backgroundNotifications, true);
			return;
		}

		const safeOperationIds = prepared.plan.operations
			.filter((operation) => operation.risk === 'safe')
			.map((operation) => operation.id);
		const reviewOperationIds = prepared.plan.operations
			.filter((operation) => operation.risk !== 'safe')
			.map((operation) => operation.id);

		let result: SyncApplyResult;
		try {
			result = await this.service.applySelection(prepared, safeOperationIds, { background: true });
		} catch {
			this.pendingOperationIds = uniqueIds([...reviewOperationIds, ...safeOperationIds]);
			this.emit('apply-failed', settings.backgroundNotifications, true);
			return;
		}

		this.pendingOperationIds = uniqueIds([...reviewOperationIds, ...result.pendingOperationIds]);
		const hasProblems = prepared.warnings.length > 0
			|| result.warnings.length > 0
			|| prepared.reviewRequiredCount > 0
			|| this.pendingOperationIds.length > 0
			|| Object.values(prepared.providerStatuses).some((status) => status.state !== 'success');
		this.emit(hasProblems ? 'problems' : 'completed', settings.backgroundNotifications, hasProblems);
	}

	private emit(kind: NotificationKind, policy: BackgroundNotifications, isProblem: boolean): void {
		if (policy === 'none' || (policy === 'problems-only' && !isProblem)) return;
		try {
			this.notify(NOTIFICATION_MESSAGES[kind]);
		} catch {
			// Notifications must never make a background run reject.
		}
	}
}
