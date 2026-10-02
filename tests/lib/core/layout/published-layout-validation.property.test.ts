import fc from 'fast-check';
import { expect, it } from 'vitest';

import { layoutGraph } from '../../../../src/app/web/projection/layout-graph';
import {
	defined,
	EndpointKind,
	JunctionOperator,
	LayoutBias,
	layoutConfiguration,
	LayoutDirection,
	type LogicDocument,
} from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import { validateLogicDocument } from '../../../../src/lib/core/document/validate-logic-document';
import { createGraph } from '../../../../src/lib/core/graph/create-graph';
import { validateDedicatedCandidate } from '../../../../src/lib/core/layout/dedicated-candidate-validation/validate';
import { layoutWithDedicatedEngineAndRankOrderWitness } from '../../../../src/lib/core/layout/layout-engine';
import { GroupRouteFailure } from '../../../../src/lib/core/layout/layout-types';
import { validLogicDocument } from '../../../support/builders/logic-document';
import { richAcyclicLogicDocumentArbitrary } from '../../../support/builders/logic-document-arbitrary';
import { PROPERTY_PARAMETERS } from '../../../support/builders/property-test-options';
import { prepareLayoutDocument } from '../../../support/harnesses/layout';

const verifyPublishedLayouts = async () => {
	let invalidCount = 0;
	const firstFailures: string[] = [];
	for (const [index, document] of fc
		.sample(richAcyclicLogicDocumentArbitrary(), {
			numRuns: PROPERTY_PARAMETERS.numRuns,
			seed: PROPERTY_PARAMETERS.seed ?? 1_592_915_777,
		})
		.entries()) {
		const prepared = prepareLayoutDocument(document);
		const layout = await layoutGraph(prepared.graph, prepared.ranks, prepared.measurements);
		const result = validateDedicatedCandidate({ ...prepared, layout });
		if (result.valid) continue;
		invalidCount += 1;
		if (firstFailures.length < 3) firstFailures.push(JSON.stringify({ index, document, result }));
	}
	expect(invalidCount, firstFailures.join('\n')).toBe(0);
};

it(
	'checks published layouts against the independent geometry validator',
	verifyPublishedLayouts,
	600_000,
);

const biasByDirection: Record<LayoutDirection, LayoutBias> = {
	[LayoutDirection.TopToBottom]: LayoutBias.Top,
	[LayoutDirection.BottomToTop]: LayoutBias.Bottom,
	[LayoutDirection.LeftToRight]: LayoutBias.Left,
	[LayoutDirection.RightToLeft]: LayoutBias.Right,
};

/** Every node draws its own group, unlike the shared arbitrary, which places a single member. */
const memberShape = fc.record({
	nodes: fc.integer({ min: 2, max: 9 }),
	junctions: fc.integer({ min: 0, max: 2 }),
	groups: fc.integer({ min: 0, max: 2 }),
	membership: fc.array(fc.integer({ min: -1, max: 1 }), { minLength: 9, maxLength: 9 }),
	edges: fc.array(fc.tuple(fc.nat(), fc.nat()), { minLength: 1, maxLength: 12 }),
	order: fc.array(fc.nat(), { minLength: 13, maxLength: 13 }),
});

type MemberShape = typeof memberShape extends fc.Arbitrary<infer T> ? T : never;

function memberDocument(shape: MemberShape, direction: LayoutDirection): LogicDocument {
	const nodeIds = Array.from({ length: shape.nodes }, (_, index) => `n${index}`);
	const junctionIds = Array.from({ length: shape.junctions }, (_, index) => `j${index}`);
	const groupIds = Array.from({ length: shape.groups }, (_, index) => `g${index}`);
	const ids = [...nodeIds, ...junctionIds, ...groupIds];
	const order = new Map(
		ids
			.map((id, index) => ({ id, key: shape.order[index] ?? index, index }))
			.toSorted((left, right) => left.key - right.key || left.index - right.index)
			.map(({ id }, index) => [id, orderKey(`a${index.toString().padStart(2, '0')}1`)]),
	);
	const groupOf = new Map<string, string>();
	for (const [index, id] of nodeIds.entries()) {
		const group = groupIds[shape.membership[index] ?? -1];
		if (group !== undefined) groupOf.set(id, group);
	}
	const relations: LogicDocument['relations'][number][] = [];
	for (const [first, second] of shape.edges) {
		const from = defined(ids[Math.max(first, second) % ids.length]);
		const to = defined(ids[Math.min(first, second) % ids.length]);
		if (from === to || groupOf.get(from) === to || groupOf.get(to) === from) continue;
		if (relations.some((relation) => relation.from === from && relation.to === to)) continue;
		relations.push({ id: `r${relations.length}-${from}-${to}`, from, to });
	}
	return {
		...validLogicDocument(),
		layout: defined(layoutConfiguration(direction, biasByDirection[direction])),
		groups: groupIds.map((id) => ({
			kind: EndpointKind.Group,
			id,
			label: id,
			layoutOrder: defined(order.get(id)),
		})),
		nodes: nodeIds.map((id) => {
			const groupId = groupOf.get(id);
			return {
				kind: EndpointKind.Node,
				id,
				natureId: 'goal',
				markdown: id,
				layoutOrder: defined(order.get(id)),
				...(groupId !== undefined && { groupId }),
			};
		}),
		junctions: junctionIds.map((id) => ({
			kind: EndpointKind.Junction,
			id,
			operator: JunctionOperator.Xor,
			layoutOrder: defined(order.get(id)),
		})),
		relations,
	};
}

// A publication the witness calls validated is never rejected; otherwise the witness says so.
it('never publishes a rejected layout as verified when groups have random members', async () => {
	const failures: string[] = [];
	for (const [index, shape] of fc
		.sample(memberShape, {
			numRuns: PROPERTY_PARAMETERS.numRuns,
			seed: PROPERTY_PARAMETERS.seed ?? 1_592_915_777,
		})
		.entries())
		for (const direction of Object.values(LayoutDirection)) {
			const document = memberDocument(shape, direction);
			if (!validateLogicDocument(document).ok || !createGraph(document).ok) continue;
			const prepared = prepareLayoutDocument(document);
			let layout;
			try {
				layout = await layoutGraph(prepared.graph, prepared.ranks, prepared.measurements);
			} catch (error) {
				if (error instanceof GroupRouteFailure) continue;
				throw error;
			}
			const result = validateDedicatedCandidate({ ...prepared, layout });
			if (result.valid) continue;
			const { witness } = layoutWithDedicatedEngineAndRankOrderWitness(
				prepared.graph,
				prepared.ranks,
				prepared.measurements,
			);
			// A rejected publication always says unverified; a verified one is never rejected.
			if (witness.unverified > 0 && witness.finalValidation?.valid !== true) continue;
			failures.push(JSON.stringify({ index, direction, result, witness: witness.work }));
		}
	expect(failures).toEqual([]);
}, 600_000);
