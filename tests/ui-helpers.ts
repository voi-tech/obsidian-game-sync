import { expect } from 'vitest';

export function bodyHeadingTexts(root: HTMLElement): string[] {
	return Array.from(root.querySelectorAll('h1, h2, h3, h4, h5, h6'))
		.map((heading) => heading.textContent?.trim() ?? '')
		.filter((text) => text.length > 0);
}

export function expectNoBodyHeadingMatchingModalTitle(root: HTMLElement, title: string): void {
	expect(bodyHeadingTexts(root)).not.toContain(title);
}
