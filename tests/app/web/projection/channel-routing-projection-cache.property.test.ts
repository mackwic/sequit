import fc from 'fast-check';
import { expect, it } from 'vitest';

import {
	createProjectionLayoutCaches,
	layoutGraph,
	layoutGraphForProjection,
	type Size,
} from '../../../../src/app/web/projection/layout-graph';
import {
	defined,
	EndpointKind,
	LAYOUT_DIRECTIONS,
	layoutConfiguration,
	LayoutDirection,
	type LogicDocument,
	type LogicRelation,
	PERSISTENCE_FORMAT,
} from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import { PROPERTY_PARAMETERS } from '../../../support/builders/property-test-options';
import { prepareLayoutDocument } from '../../../support/harnesses/layout';
import { defaultBiasFor } from '../../../support/harnesses/visual-directions';

const LAYERS = 4;

interface DraftNode {
	readonly id: string;
	readonly layer: number;
}

/** Relations only go to a later layer, so every draft is acyclic. */
interface Draft {
	readonly nodes: readonly DraftNode[];
	readonly relations: readonly LogicRelation[];
	readonly sizes: Readonly<Record<string, Size>>;
	readonly direction: LayoutDirection;
}

type Edit =
	| { readonly kind: 'node'; readonly layer: number; readonly parent: number }
	| { readonly kind: 'relation'; readonly from: number; readonly to: number; readonly span: number }
	| { readonly kind: 'unlink'; readonly relation: number }
	| { readonly kind: 'resize'; readonly node: number; readonly width: number }
	| { readonly kind: 'direction'; readonly direction: number }
	| { readonly kind: 'same' };

const editArbitrary: fc.Arbitrary<Edit> = fc.oneof(
	{
		weight: 4,
		arbitrary: fc.record({
			kind: fc.constant('node' as const),
			layer: fc.integer({ min: 0, max: LAYERS - 1 }),
			parent: fc.nat(),
		}),
	},
	{
		weight: 3,
		arbitrary: fc.record({
			kind: fc.constant('relation' as const),
			from: fc.nat(),
			to: fc.nat(),
			span: fc.integer({ min: 1, max: 2 }),
		}),
	},
	{ weight: 1, arbitrary: fc.record({ kind: fc.constant('unlink' as const), relation: fc.nat() }) },
	{
		weight: 1,
		arbitrary: fc.record({
			kind: fc.constant('resize' as const),
			node: fc.nat(),
			width: fc.integer({ min: 120, max: 320 }),
		}),
	},
	{
		weight: 1,
		arbitrary: fc.record({ kind: fc.constant('direction' as const), direction: fc.nat() }),
	},
	{ weight: 1, arbitrary: fc.record({ kind: fc.constant('same' as const) }) },
);

function withRelation(draft: Draft, from: DraftNode, to: DraftNode): Draft {
	if (draft.relations.some((relation) => relation.from === from.id && relation.to === to.id))
		return draft;
	const relation = {
		id: `r${draft.relations.length}-${from.id}-${to.id}`,
		from: from.id,
		to: to.id,
	};
	return { ...draft, relations: [...draft.relations, relation] };
}

function withNode(draft: Draft, layer: number, parent: number): Draft {
	const node = { id: `n${draft.nodes.length}`, layer };
	const next = { ...draft, nodes: [...draft.nodes, node] };
	const parents = draft.nodes.filter((candidate) => candidate.layer === layer - 1);
	if (parents.length === 0) return next;
	return withRelation(next, defined(parents[parent % parents.length]), node);
}

function linked(draft: Draft, edit: Extract<Edit, { kind: 'relation' }>): Draft {
	const from = defined(draft.nodes[edit.from % draft.nodes.length]);
	const targets = draft.nodes.filter(({ layer }) => layer === from.layer + edit.span);
	if (targets.length === 0) return draft;
	return withRelation(draft, from, defined(targets[edit.to % targets.length]));
}

function applyEdit(draft: Draft, edit: Edit): Draft {
	if (edit.kind === 'node') return withNode(draft, edit.layer, edit.parent);
	if (edit.kind === 'relation') return linked(draft, edit);
	if (edit.kind === 'unlink') {
		if (draft.relations.length === 0) return draft;
		const removed = edit.relation % draft.relations.length;
		return { ...draft, relations: draft.relations.filter((_, index) => index !== removed) };
	}
	if (edit.kind === 'resize') {
		const { id } = defined(draft.nodes[edit.node % draft.nodes.length]);
		return { ...draft, sizes: { ...draft.sizes, [id]: { width: edit.width, height: 116 } } };
	}
	if (edit.kind === 'direction')
		return {
			...draft,
			direction: defined(LAYOUT_DIRECTIONS[edit.direction % LAYOUT_DIRECTIONS.length]),
		};
	return draft;
}

function documentFor(draft: Draft): LogicDocument {
	return {
		persistenceFormat: PERSISTENCE_FORMAT,
		id: 'channel-cache-sequence',
		title: 'Channel cache sequence',
		layout: defined(layoutConfiguration(draft.direction, defaultBiasFor(draft.direction))),
		natures: [{ id: 'goal', label: 'Goal', color: '#00aa44' }],
		groups: [],
		nodes: draft.nodes.map(({ id }, index) => ({
			kind: EndpointKind.Node,
			id,
			natureId: 'goal',
			markdown: `${id}\n`,
			layoutOrder: orderKey(`a${index.toString().padStart(4, '0')}1`),
		})),
		junctions: [],
		relations: draft.relations,
	};
}

const SEED_DRAFT: Draft = [0, 0, 1, 1, 2].reduce<Draft>(
	(draft, layer, index) => withNode(draft, layer, index),
	{ nodes: [], relations: [], sizes: {}, direction: LayoutDirection.TopToBottom },
);

it('keeps projection layouts equal to cold layouts over generated edit sequences', async () => {
	let hits = 0;
	await fc.assert(
		fc.asyncProperty(fc.array(editArbitrary, { minLength: 1, maxLength: 12 }), async (edits) => {
			const caches = createProjectionLayoutCaches();
			let draft = SEED_DRAFT;
			for (const edit of [{ kind: 'same' } as const, ...edits]) {
				draft = applyEdit(draft, edit);
				const document = documentFor(draft);
				const { graph, ranks, measurements } = prepareLayoutDocument(document, {
					nodes: draft.sizes,
				});
				expect(await layoutGraphForProjection(graph, ranks, measurements, caches)).toStrictEqual(
					await layoutGraph(graph, ranks, measurements),
				);
			}
			hits += caches.channels.stats.hits;
		}),
		PROPERTY_PARAMETERS,
	);
	expect(hits).toBeGreaterThan(0);
}, 600_000);
