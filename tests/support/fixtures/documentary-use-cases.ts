import type { LayoutDirection } from '../../../src/lib/core/document/logic-document';
import type { VisualGraphBuilder, VisualGraphData } from '../builders/visual-graph-builder';
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

/** Each family of the reworked group, with the parent its children hang from. */
export const REWORKED_USE_CASES_FAMILIES: readonly (readonly [
	children: readonly string[],
	parent: string,
])[] = [
	[['all-edits', 'intuitive', 'onlyoffice'], 'familiar'],
	[['all-edits', 'intuitive', 'onlyoffice'], 'xor'],
	[['xor'], 'familiar'],
	[['docx'], 'lossless'],
	[['lossless'], 'isolated'],
	[['orchestration', 'conclusion'], 'interdependent'],
	[['familiar'], 'training'],
	[['freshness'], 'regenerate'],
	[['regenerate'], 'documents-live'],
	[['word-alcoa'], 'traceable'],
];

function addReworkedUseCases(builder: VisualGraphBuilder): VisualGraphBuilder {
	return builder
		.nodes(REWORKED_USE_CASES)
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
		.arrowsFrom('xor', ['familiar']);
}

export function reworkedUseCases(direction: LayoutDirection): VisualGraphData {
	return addReworkedUseCases(graphFixtures.routingNodes([], direction, 204)).build();
}

/** Root boxes of the documentary-effort map, in documentary order, before the group. */
const MAP_ROOT = [
	'alcoa-plus',
	'partner-content',
	'docx-word',
	'prompt',
	'guarantees',
	'minimal',
	'ai-tooling',
	'goal',
] as const;

/** The "Use cases" group and the empty "Data team" group feeding AI tooling. */
export const DOCUMENTARY_MAP_GROUPS = { ...REWORKED_USE_CASES_GROUPS, 'data-team': [] } as const;

/**
 * The whole documentary-effort map: the goal's tree at the root beside the "Use cases" group.
 * Linking the goal to the traceability need joins both into one component.
 */
export function documentaryMap(
	direction: LayoutDirection,
	options: { readonly goalToTraceable: boolean },
): VisualGraphData {
	const builder = addReworkedUseCases(
		graphFixtures
			.routingNodes(MAP_ROOT, direction, 204)
			.arrowsFrom('alcoa-plus', ['guarantees'])
			.arrowsFrom('partner-content', ['guarantees'])
			.arrowsFrom('docx-word', ['minimal'])
			.arrowsFrom('prompt', ['ai-tooling'])
			.arrowsFrom('guarantees', ['goal'])
			.arrowsFrom('minimal', ['goal'])
			.arrowsFrom('ai-tooling', ['goal']),
	);
	if (options.goalToTraceable) builder.arrowsFrom('goal', ['traceable']);
	const data = builder.build();
	// The builder only links boxes: the group endpoint is added to the built relations.
	const dataTeam = { id: 'data-team-to-ai-tooling', from: 'data-team', to: 'ai-tooling' };
	return { ...data, relations: [...data.relations, dataTeam] };
}
