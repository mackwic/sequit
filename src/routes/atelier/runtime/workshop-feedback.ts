export interface WorkshopFeedbackEntry {
	readonly preference: string;
	readonly notes: string;
	readonly next: string;
	readonly tested: string;
}
export const emptyFeedback: WorkshopFeedbackEntry = {
	preference: '',
	notes: '',
	next: '',
	tested: '',
};

/** Storage is untrusted; preserve valid entries without coupling them to the current catalogue. */
export function parseWorkshopFeedback(
	source: string | null,
): Record<string, WorkshopFeedbackEntry> {
	const raw: unknown = JSON.parse(source ?? '{}');
	const records: Record<string, WorkshopFeedbackEntry> = {};
	if (typeof raw !== 'object' || raw === null) return records;
	for (const [id, value] of Object.entries(raw)) {
		const candidate: unknown = value;
		if (typeof candidate !== 'object' || candidate === null) continue;
		if (
			!('preference' in candidate) ||
			typeof candidate.preference !== 'string' ||
			!('notes' in candidate) ||
			typeof candidate.notes !== 'string' ||
			!('next' in candidate) ||
			typeof candidate.next !== 'string' ||
			!('tested' in candidate) ||
			typeof candidate.tested !== 'string'
		)
			continue;
		Object.defineProperty(records, id, {
			value: {
				preference: candidate.preference,
				notes: candidate.notes,
				next: candidate.next,
				tested: candidate.tested,
			},
			enumerable: true,
			writable: true,
			configurable: true,
		});
	}
	return records;
}

export function workshopFeedbackMarkdown(
	scenarios: readonly { readonly id: string; readonly label: string }[],
	records: Readonly<Record<string, WorkshopFeedbackEntry>>,
): string {
	return `# Atelier Sequit — retours\n\n${scenarios
		.map((item) => {
			const entry = records[item.id] ?? emptyFeedback;
			return `## ${item.id} — ${item.label}\n\nVariantes essayées : ${entry.tested}\n\nPréférence : ${entry.preference}\n\nObservations :\n${entry.notes}\n\nÀ changer au prochain essai :\n${entry.next}\n`;
		})
		.join('\n')}`;
}
