import type { LayoutDirection } from '../../../src/lib/core/document/logic-document';
import type { VisualGraphData } from '../builders/visual-graph-builder';
import { graphFixtures } from './graph-fixtures';

/** The "Use cases" group of the documentary-effort map, in its documentary order. */
export const DOCUMENTARY_USE_CASES = [
	'documents-live',
	'traceable',
	'training',
	'regenerate',
	'familiar',
	'freshness',
	'intuitive',
	'onlyoffice',
	'orchestration',
	'all-edits',
	'interdependent',
	'isolated',
	'word-alcoa',
	'conclusion',
	'lossless',
	'docx',
] as const;

/** Every box and the XOR junction belong to the "Use cases" group. */
export const USE_CASES_GROUPS = { 'use-cases': [...DOCUMENTARY_USE_CASES, 'xor'] } as const;

export function documentaryUseCases(
	direction: LayoutDirection,
	order: readonly string[] = DOCUMENTARY_USE_CASES,
): VisualGraphData {
	return graphFixtures
		.routingNodes(order, direction, 204)
		.junctions(['xor'])
		.arrowsFrom('regenerate', ['documents-live'])
		.arrowsFrom('word-alcoa', ['traceable', 'orchestration'])
		.arrowsFrom('familiar', ['training'])
		.arrowsFrom('freshness', ['regenerate'])
		.arrowsFrom('intuitive', ['xor'])
		.arrowsFrom('onlyoffice', ['xor'])
		.arrowsFrom('all-edits', ['xor', 'freshness'])
		.arrowsFrom('xor', ['familiar'])
		.arrowsFrom('orchestration', ['freshness'])
		.arrowsFrom('interdependent', ['orchestration'])
		.arrowsFrom('isolated', ['orchestration'])
		.arrowsFrom('conclusion', ['interdependent'])
		.arrowsFrom('lossless', ['isolated'])
		.arrowsFrom('docx', ['lossless'])
		.build();
}

/**
 * The same group as the map documents it today, in its documentary order. The XOR family's
 * parent stands right of another family's parent, while the documentary order puts it first.
 */
const REWORKED_USE_CASES = [
	'orchestration',
	'all-edits',
	'conclusion',
	'documents-live',
	'docx',
	'familiar',
	'freshness',
	'interdependent',
	'intuitive',
	'isolated',
	'lossless',
	'onlyoffice',
	'regenerate',
	'traceable',
	'training',
	'word-alcoa',
] as const;

export const REWORKED_USE_CASES_GROUPS = { 'use-cases': [...REWORKED_USE_CASES, 'xor'] } as const;

export function reworkedUseCases(direction: LayoutDirection): VisualGraphData {
	return graphFixtures
		.routingNodes(REWORKED_USE_CASES, direction, 204)
		.junctions(['xor'])
		.arrowsFrom('regenerate', ['documents-live'])
		.arrowsFrom('freshness', ['regenerate'])
		.arrowsFrom('word-alcoa', ['traceable'])
		.arrowsFrom('familiar', ['training'])
		.arrowsFrom('lossless', ['isolated'])
		.arrowsFrom('docx', ['lossless'])
		.arrowsFrom('orchestration', ['interdependent'])
		.arrowsFrom('conclusion', ['interdependent'])
		.arrowsFrom('all-edits', ['xor'])
		.arrowsFrom('intuitive', ['xor'])
		.arrowsFrom('onlyoffice', ['xor'])
		.arrowsFrom('xor', ['familiar'])
		.build();
}
