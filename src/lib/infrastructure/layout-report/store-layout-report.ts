import { LAYOUT_REPORT_MAX_BYTES } from './layout-report';
import { parseLayoutReport } from './parse-layout-report';

/** The part of an R2 bucket that storing a report needs. */
export interface LayoutReportBucket {
	put(
		key: string,
		value: string,
		options: {
			readonly httpMetadata: { readonly contentType: string };
			readonly customMetadata: Readonly<Record<string, string>>;
		},
	): Promise<unknown>;
}

/** The deployed Worker version that received the report. */
export interface LayoutReportBuild {
	readonly id: string;
	readonly tag: string;
	readonly timestamp: string;
}

export interface LayoutReportReception {
	readonly id: string;
	readonly at: Date;
	readonly build?: LayoutReportBuild | undefined;
}

export enum LayoutReportStoreOutcomeKind {
	Stored = 'stored',
	TooLarge = 'too-large',
	Malformed = 'malformed',
}

interface StoredLayoutReport {
	readonly kind: LayoutReportStoreOutcomeKind.Stored;
	readonly id: string;
	readonly key: string;
}

interface RefusedLayoutReport {
	readonly kind: LayoutReportStoreOutcomeKind.TooLarge | LayoutReportStoreOutcomeKind.Malformed;
}

export type LayoutReportStoreOutcome = StoredLayoutReport | RefusedLayoutReport;

function parseJson(body: string): unknown {
	try {
		return JSON.parse(body);
	} catch {
		return undefined;
	}
}

/** One object per report, under the UTC day it arrived, so that a listing reads in order. */
function layoutReportKey(reception: LayoutReportReception): string {
	return `layout-reports/${reception.at.toISOString().slice(0, 10)}/${reception.id}.json`;
}

/**
 * Validates a request body and writes the rebuilt report with its reception metadata. Unknown
 * fields are dropped; the category and build also go to the object metadata, for listings.
 */
export async function storeLayoutReport(
	bucket: LayoutReportBucket,
	body: string,
	reception: LayoutReportReception,
): Promise<LayoutReportStoreOutcome> {
	if (new TextEncoder().encode(body).byteLength > LAYOUT_REPORT_MAX_BYTES)
		return { kind: LayoutReportStoreOutcomeKind.TooLarge };
	const report = parseLayoutReport(parseJson(body));
	if (report === undefined) return { kind: LayoutReportStoreOutcomeKind.Malformed };
	const key = layoutReportKey(reception);
	const receivedAt = reception.at.toISOString();
	const metadata: Record<string, string> = { category: report.category, receivedAt };
	if (reception.build !== undefined) metadata['build'] = reception.build.id;
	await bucket.put(
		key,
		JSON.stringify({ id: reception.id, receivedAt, build: reception.build ?? null, ...report }),
		{ httpMetadata: { contentType: 'application/json' }, customMetadata: metadata },
	);
	return { kind: LayoutReportStoreOutcomeKind.Stored, id: reception.id, key };
}
