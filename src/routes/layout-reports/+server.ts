import { json, type RequestHandler } from '@sveltejs/kit';

import { LAYOUT_REPORT_MAX_BYTES } from '../../lib/infrastructure/layout-report/layout-report';
import {
	LayoutReportStoreOutcomeKind,
	storeLayoutReport,
} from '../../lib/infrastructure/layout-report/store-layout-report';

const REFUSAL_STATUS = {
	[LayoutReportStoreOutcomeKind.TooLarge]: 413,
	[LayoutReportStoreOutcomeKind.Malformed]: 400,
} as const;

/** Stores an anonymized layout report in R2; per-address limits belong to a WAF rule. */
export const POST: RequestHandler = async ({ request, platform }) => {
	const bucket = platform?.env.LAYOUT_REPORTS;
	if (bucket === undefined) return json({ error: 'unavailable' }, { status: 503 });
	if (Number(request.headers.get('content-length')) > LAYOUT_REPORT_MAX_BYTES)
		return json({ error: LayoutReportStoreOutcomeKind.TooLarge }, { status: 413 });
	const outcome = await storeLayoutReport(bucket, await request.text(), {
		id: crypto.randomUUID(),
		at: new Date(),
		build: platform?.env.CF_VERSION_METADATA,
	});
	if (outcome.kind === LayoutReportStoreOutcomeKind.Stored)
		return json({ id: outcome.id }, { status: 201 });
	return json({ error: outcome.kind }, { status: REFUSAL_STATUS[outcome.kind] });
};
