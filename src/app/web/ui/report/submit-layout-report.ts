import type { LayoutReport } from '../../../../lib/infrastructure/layout-report/layout-report';
import { record } from '../../../../lib/infrastructure/layout-report/parse-report-values';

export const LAYOUT_REPORT_ENDPOINT = '/layout-reports';

interface SentLayoutReport {
	readonly ok: true;
	readonly id: string;
}

interface UnsentLayoutReport {
	readonly ok: false;
	/** The HTTP status that refused the report, or 0 when the server was not reached. */
	readonly status: number;
}

export type LayoutReportSubmission = SentLayoutReport | UnsentLayoutReport;

async function storedId(response: Response): Promise<string | undefined> {
	if (!response.ok) return undefined;
	const body: unknown = await response.json().catch(() => undefined);
	const id = record(body)?.['id'];
	if (typeof id !== 'string') return undefined;
	return id;
}

/** Sends a captured report; the server answers with the identifier it stored it under. */
export async function submitLayoutReport(
	report: LayoutReport,
	send: typeof fetch = fetch,
): Promise<LayoutReportSubmission> {
	let response: Response;
	try {
		response = await send(LAYOUT_REPORT_ENDPOINT, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(report),
		});
	} catch {
		return { ok: false, status: 0 };
	}
	const id = await storedId(response);
	if (id === undefined) return { ok: false, status: response.status };
	return { ok: true, id };
}
