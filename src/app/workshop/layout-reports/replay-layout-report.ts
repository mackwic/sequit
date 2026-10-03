import { anonymizeDocument } from '../../../lib/core/document/anonymize-document';
import {
	GroupState,
	type LogicDocument,
	type LogicGroup,
} from '../../../lib/core/document/logic-document';
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
	/** `Name: message` of the error, then of each error that caused it. */
	readonly causes: readonly string[];
	/** The stack of the innermost cause, where the engine gave up. */
	readonly stack: string | undefined;
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

/** The error and the errors that caused it, outermost first. */
function errorChain(error: unknown): readonly unknown[] {
	const chain: unknown[] = [];
	let current = error;
	while (current !== undefined && !chain.includes(current)) {
		chain.push(current);
		if (!(current instanceof Error)) break;
		current = current.cause;
	}
	return chain;
}

function describeError(error: unknown): string {
	if (error instanceof Error) return `${error.name}: ${error.message}`;
	return String(error);
}

function failedReplay(report: LayoutReport, error: unknown): FailedReplay {
	const failure = failureCode(error);
	const chain = errorChain(error);
	const innermost = chain.at(-1);
	let stack: string | undefined;
	if (innermost instanceof Error) stack = innermost.stack;
	return {
		kind: LayoutReplayKind.Failed,
		failure,
		reproduced: failure === report.failure,
		causes: chain.map(describeError),
		stack,
	};
}

function reportedDocument(report: LayoutReport): LogicDocument | undefined {
	const parsed = parseSequitToml(report.document);
	if (!parsed.ok) return undefined;
	return parsed.value;
}

/** The groups of the reported document, folded or not as the reporter saw them. */
export function reportedGroups(report: LayoutReport): readonly LogicGroup[] {
	return reportedDocument(report)?.groups ?? [];
}

function flippedState(state: GroupState | undefined): GroupState {
	if (state === GroupState.Closed) return GroupState.Expanded;
	return GroupState.Closed;
}

/** The document with the named groups folded if they were unfolded, and unfolded otherwise. */
function withFlippedGroups(document: LogicDocument, flipped: ReadonlySet<string>): LogicDocument {
	if (flipped.size === 0) return document;
	return {
		...document,
		groups: document.groups.map((group) => {
			if (!flipped.has(group.id)) return group;
			return { ...group, state: flippedState(group.state) };
		}),
	};
}

/**
 * Lays the reported document out from scratch with the reported measurements, here and now. The
 * report is anonymous already, so anonymizing it again maps every identifier to itself and names
 * the undefined ones `x…` exactly as the reporter's page did. `flipped` names groups to fold or
 * unfold first, to replay the other side of a folding.
 */
export async function replayLayoutReport(
	report: LayoutReport,
	flipped: ReadonlySet<string> = new Set(),
): Promise<LayoutReplay> {
	const reported = reportedDocument(report);
	if (reported === undefined) return { kind: LayoutReplayKind.InvalidDocument, reproduced: false };
	const document = withFlippedGroups(reported, flipped);
	const rename = createRename(anonymizeDocument(document).identifiers);
	try {
		const canvas = await createSharedCanvasProjection(document).createCanvasModel(
			measurements(report.measurements),
		);
		const layout = reportedLayout(canvas, rename);
		const reproduced = JSON.stringify(layout) === JSON.stringify(report.layout);
		return { kind: LayoutReplayKind.Laid, layout, reproduced };
	} catch (error) {
		return failedReplay(report, error);
	}
}
