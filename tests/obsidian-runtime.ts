export const getLanguage = (): string => 'en';

export class Modal {
	contentEl = document.createElement('div');

	constructor(public readonly app: unknown) {}

	setTitle(_title: string): this {
		return this;
	}

	onOpen(): void {}

	onClose(): void {}
}

export class Setting {
	constructor(public readonly containerEl: HTMLElement) {}
}
