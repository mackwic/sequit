const REVOKE_DELAY_MS = 1000;

/** Offers `blob` as a file download through a transient object URL. */
export function downloadBlob(blob: Blob, filename: string): void {
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement('a');
	anchor.href = url;
	anchor.download = filename;
	anchor.click();
	setTimeout(() => {
		URL.revokeObjectURL(url);
	}, REVOKE_DELAY_MS);
}

/** Offers `content` as a text file download. */
export function downloadText(content: string, filename: string): void {
	downloadBlob(new Blob([content], { type: 'text/plain;charset=utf-8' }), filename);
}
