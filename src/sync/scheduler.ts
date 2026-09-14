import type { Component } from 'obsidian';
import { isSupportedBackgroundIntervalMinutes, type BackgroundNotifications, type GameSyncSettings } from '../model/settings';
import type { SyncExclusiveRunner } from './concurrency';
import type { SyncExecutor } from './background-executor';
export type { SyncExecutor, SyncExecutorAttention, SyncExecutorOperation, SyncExecutorPreview, SyncExecutorResult } from './background-executor';

export interface BackgroundSyncSchedulerOptions {
	component: Pick<Component, 'registerInterval'>;
	isMobile: () => boolean;
	readSettings: () => GameSyncSettings | Promise<GameSyncSettings>;
	executor: SyncExecutor;
	runExclusive?: SyncExclusiveRunner;
	timer: Pick<Window, 'setInterval' | 'clearInterval'>;
	notify?: (message: string) => void;
}

export type BackgroundSyncSchedulerState = 'stopped' | 'scheduled' | 'running';

type TimerHandle = number;
type NotificationKind = 'completed' | 'prepare-failed' | 'apply-failed' | 'problems';
type SyncExecutorPreview = Awaited<ReturnType<SyncExecutor['preview']>>;

const NOTIFICATION_MESSAGES: Record<NotificationKind, string> = {
	completed: 'Game Sync: background sync completed.',
	'prepare-failed': 'Game Sync: background sync failed while preparing data.',
	'apply-failed': 'Game Sync: background sync failed while applying changes.',
	problems: 'Game Sync: background sync completed with items requiring attention.',
};

function uniqueIds(ids: readonly string[]): string[] {
	return [...new Set(ids)];
}

function attentionIds(preview: SyncExecutorPreview): string[] {
	return preview.attention.map((item) => item.id);
}

export class BackgroundSyncScheduler {
	private readonly component: Pick<Component, 'registerInterval'>;
	private readonly isMobile: () => boolean;
	private readonly readSettings: () => GameSyncSettings | Promise<GameSyncSettings>;
	private readonly executor: SyncExecutor;
	private readonly runExclusive?: SyncExclusiveRunner;
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
		this.executor = options.executor;
		this.runExclusive = options.runExclusive;
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
		const operation = () => this.executeRun();
		const run = (this.runExclusive === undefined ? operation() : this.runExclusive(operation))
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
		const automatic = this.canRunAutomatically();
		const automaticAllowed = automatic === true || (automatic !== false && await automatic);
		if (!automaticAllowed || !settings.backgroundSync || !isSupportedBackgroundIntervalMinutes(settings.backgroundIntervalMinutes)) return;

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

	private canRunAutomatically(): boolean | Promise<boolean> {
		try {
			const result = this.executor.canRunAutomatically?.() ?? true;
			return result instanceof Promise ? result.catch(() => false) : result;
		} catch {
			return false;
		}
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
		const automatic = this.canRunAutomatically();
		const automaticAllowed = automatic === true || (automatic !== false && await automatic);
		if (!automaticAllowed || !settings.backgroundSync || !isSupportedBackgroundIntervalMinutes(settings.backgroundIntervalMinutes)) return;

		let preview: SyncExecutorPreview;
		try {
			preview = await this.executor.preview();
		} catch {
			this.emit('prepare-failed', settings.backgroundNotifications, true);
			return;
		}

		const reviewIds = preview.operations.filter((operation) => operation.risk !== 'safe').map((operation) => operation.id);
		const attention = attentionIds(preview);
		const pendingBeforeApply = uniqueIds([...reviewIds, ...attention]);
		if (preview.status !== 'complete' || preview.approvalRequired) {
			this.pendingOperationIds = uniqueIds([
				...preview.operations.map((operation) => operation.id),
				...pendingBeforeApply,
			]);
			this.emit('problems', settings.backgroundNotifications, true);
			return;
		}

		const safeOperationIds = preview.operations.filter((operation) => operation.risk === 'safe').map((operation) => operation.id);
		let result: Awaited<ReturnType<SyncExecutor['apply']>>;
		try {
			result = await this.executor.apply(preview, safeOperationIds);
		} catch {
			this.pendingOperationIds = uniqueIds([...safeOperationIds, ...pendingBeforeApply]);
			this.emit('apply-failed', settings.backgroundNotifications, true);
			return;
		}

		this.pendingOperationIds = uniqueIds([...pendingBeforeApply, ...result.pendingOperationIds]);
		const hasProblems = preview.warnings.length > 0
			|| result.warnings.length > 0
			|| preview.attention.length > 0
			|| preview.operations.some((operation) => operation.risk !== 'safe')
			|| this.pendingOperationIds.length > 0
			|| preview.providerStatuses.some((status) => status.state !== 'success');
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
