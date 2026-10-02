import { anonymizeDocument } from '../../../lib/core/document/anonymize-document';
import type {
	LayoutReport,
	ReportedLayout,
	ReportedMeasurements,
} from '../../../lib/infrastructure/layout-report/layout-report';
import { parseSequitToml } from '../../../lib/infrastructure/toml/parse-sequit-toml';
import { LayoutProjectionError } from '../../web/projection/layout-diagnostic';
import type { LayoutMeasurements } from '../../web/projection/layout-graph';
import { createSharedCanvasProjection } from '../../web/projection/shared-canvas-projection';
import { SourceDocumentProjectionError } from '../../web/projection/source-document-diagnostic';
import { createRename, reportedLayout } from '../../web/ui/report/report-geometry';

export enum LayoutReplayKind {
	Laid = 'laid',
	Failed = 'failed',
	InvalidDocument = 'invalid-document',
}

interface LaidReplay {
	readonly kind: LayoutReplayKind.Laid;
	readonly layout: ReportedLayout;
	/** The replay gave exactly the geometry the reporter's page computed. */
	readonly reproduced: boolean;
}

interface FailedReplay {
	readonly kind: LayoutReplayKind.Failed;
	/** The failure code, as the canvas names it. */
	readonly failure: string;
	readonly reproduced: boolean;
}

interface InvalidDocumentReplay {
	readonly kind: LayoutReplayKind.InvalidDocument;
	readonly reproduced: false;
}

export type LayoutReplay = LaidReplay | FailedReplay | InvalidDocumentReplay;

function measurements(reported: ReportedMeasurements): LayoutMeasurements {
	return {
		nodes: new Map(reported.nodes),
		junctions: new Map(reported.junctions),
		groups: new Map(reported.groups),
	};
}

/** The code the canvas shows for a failed projection. */
function failureCode(error: unknown): string {
	if (error instanceof SourceDocumentProjectionError) return 'invalid-source';
	if (error instanceof LayoutProjectionError) return error.diagnostic.reason.code;
	return 'layout-failed';
}

/**
 * Lays the reported document out from scratch with the reported measurements, here and now. The
 * report is anonymous already, so anonymizing it again maps every identifier to itself and names
 * the undefined ones `x…` exactly as the reporter's page did.
 */
export async function replayLayoutReport(report: LayoutReport): Promise<LayoutReplay> {
	const parsed = parseSequitToml(report.document);
	if (!parsed.ok) return { kind: LayoutReplayKind.InvalidDocument, reproduced: false };
	const document = parsed.value;
	const rename = createRename(anonymizeDocument(document).identifiers);
	try {
		const canvas = await createSharedCanvasProjection(document).createCanvasModel(
			measurements(report.measurements),
		);
		const layout = reportedLayout(canvas, rename);
		const reproduced = JSON.stringify(layout) === JSON.stringify(report.layout);
		return { kind: LayoutReplayKind.Laid, layout, reproduced };
	} catch (error) {
		const failure = failureCode(error);
		return { kind: LayoutReplayKind.Failed, failure, reproduced: failure === report.failure };
	}
}
