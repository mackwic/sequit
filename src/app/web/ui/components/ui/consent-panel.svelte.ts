/**
 * The analytics consent panel, shared by the layout that shows it and the document menu that
 * reopens it. Only the browser changes it: the server renders the panel closed and unavailable.
 */
class ConsentPanel {
	/** Whether analytics, and so the panel, exist on this page. */
	available = $state(false);
	open = $state(false);
	/** The control to focus again once the panel closes, when it was opened from one. */
	opener: HTMLElement | undefined;

	show(opener?: HTMLElement): void {
		this.opener = opener;
		this.open = true;
	}

	close(): void {
		this.open = false;
		const opener = this.opener;
		this.opener = undefined;
		opener?.focus();
	}
}

export const consentPanel = new ConsentPanel();
