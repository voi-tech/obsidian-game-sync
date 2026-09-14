import { Setting } from 'obsidian';
import { t } from '../i18n';
import type { ProviderConnectionStatus } from '../providers/provider';

export function connectionStatusText(status: ProviderConnectionStatus | undefined): string {
	if (status?.state === 'connected') {
		const displayName = status.account?.displayName;
		return displayName === undefined ? `${t('settings.common.connectedMark')} ${t('settings.common.statusConnected')}` : `${t('settings.common.connectedMark')} ${t('settings.common.connectedAs', { displayName })}`;
	}
	if (status?.state === 'needs-auth') return t('settings.common.statusNeedsAuth');
	if (status?.state === 'error') return t('settings.common.statusError');
	return status === undefined ? t('settings.common.statusUnknown') : t('settings.common.statusDisconnected');
}

export function renderConnectionStatus(setting: Setting, description: string, status: ProviderConnectionStatus | undefined): HTMLElement {
	setting.setDesc(description);
	const statusEl = setting.descEl.createSpan();
	statusEl.dataset.providerStatus = status?.provider ?? 'unknown';
	statusEl.dataset.connectionState = status?.state ?? 'unknown';
	statusEl.textContent = connectionStatusText(status);
	return statusEl;
}

export function renderStatusMessage(container: HTMLElement, message: string): void {
	container.replaceChildren();
	for (const paragraph of message.split(/\n\n+/u).map((value) => value.trim()).filter((value) => value.length > 0)) {
		container.createEl('p').textContent = paragraph;
	}
}
