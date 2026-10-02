import type { LayoutReport } from '../../../lib/infrastructure/layout-report/layout-report';
import { parseLayoutReport } from '../../../lib/infrastructure/layout-report/parse-layout-report';
import { record, text } from '../../../lib/infrastructure/layout-report/parse-report-values';
import type { LayoutReportBuild } from '../../../lib/infrastructure/layout-report/store-layout-report';

/** A report as `pnpm reports:pull` copied it: the stored report with its reception. */
export interface PulledLayoutReport {
	readonly id: string;
	readonly receivedAt: string;
	/** The deployed Worker version that received it; absent outside a deployment. */
	readonly build?: LayoutReportBuild;
	readonly report: LayoutReport;
}

const shortText = text(200);

function build(value: unknown): LayoutReportBuild | null | undefined {
	if (value === null) return null;
	const fields = record(value);
	const id = shortText(fields?.['id']);
	const tag = shortText(fields?.['tag']);
	const timestamp = shortText(fields?.['timestamp']);
	if (id === undefined || tag === undefined || timestamp === undefined) return undefined;
	return { id, tag, timestamp };
}

/** A pulled file, or `undefined` when it is not a stored report this version can read. */
function parsePulledLayoutReport(value: unknown): PulledLayoutReport | undefined {
	const fields = record(value);
	const id = shortText(fields?.['id']);
	const receivedAt = shortText(fields?.['receivedAt']);
	const reception = build(fields?.['build']);
	const report = parseLayoutReport(value);
	if (id === undefined || receivedAt === undefined) return undefined;
	if (reception === undefined || report === undefined) return undefined;
	if (reception === null) return { id, receivedAt, report };
	return { id, receivedAt, build: reception, report };
}

/** Newest first, as the bucket keys them by day. */
function compareByReception(left: PulledLayoutReport, right: PulledLayoutReport): number {
	return right.receivedAt.localeCompare(left.receivedAt);
}

export interface PulledLayoutReports {
	readonly reports: readonly PulledLayoutReport[];
	/** Pulled files this version cannot read, by path. */
	readonly unreadable: readonly string[];
}

/** The reports in the pulled files the workshop endpoint lists; `undefined` for another answer. */
export function parsePulledFiles(value: unknown): PulledLayoutReports | undefined {
	const files = record(value)?.['files'];
	if (!Array.isArray(files)) return undefined;
	const reports: PulledLayoutReport[] = [];
	const unreadable: string[] = [];
	for (const file of files) {
		const fields = record(file);
		const path = text(1_000)(fields?.['path']);
		if (path === undefined) return undefined;
		const pulled = parsePulledLayoutReport(fields?.['content']);
		if (pulled === undefined) unreadable.push(path);
		else reports.push(pulled);
	}
	return { reports: reports.sort(compareByReception), unreadable };
}
