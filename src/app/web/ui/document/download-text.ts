const REVOKE_DELAY_MS = 1000;

/** Offers `content` as a file download through a transient object URL. */
export function downloadText(content: string, filename: string): void {
	const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }));
	const anchor = document.createElement('a');
	anchor.href = url;
	anchor.download = filename;
	anchor.click();
	setTimeout(() => {
		URL.revokeObjectURL(url);
	}, REVOKE_DELAY_MS);
}
