import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
	defined,
	EndpointKind,
	JunctionOperator,
	LayoutBias,
	type LayoutConfiguration,
	layoutConfiguration,
	LayoutDirection,
	type LogicDocument,
	type LogicGroup,
	type LogicJunction,
	type LogicNode,
	type LogicRelation,
	PERSISTENCE_FORMAT,
} from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import { validateDedicatedCandidate } from '../../../../src/lib/core/layout/dedicated-candidate-validation/validate';
import { layoutWithDedicatedEngineAndRankOrderWitness } from '../../../../src/lib/core/layout/layout-engine';
import { PORT_INSET } from '../../../../src/lib/core/layout/layout-settings';
import type {
	Bounds,
	GroupMeasurement,
	LayoutResult,
	Size,
} from '../../../../src/lib/core/layout/layout-types';
import { richAcyclicLogicDocumentArbitrary } from '../../../support/builders/logic-document-arbitrary';
import { PROPERTY_PARAMETERS } from '../../../support/builders/property-test-options';
import {
	boundsFor,
	contains,
	coordinateAt,
	layoutDocument,
	overlaps,
	prepareLayoutDocument,
	progressesFromTo,
} from '../../../support/harnesses/layout';

interface ComponentCase {
	readonly document: LogicDocument;
	readonly nodes: Readonly<Record<string, Size>>;
	readonly junctions: Readonly<Record<string, Size>>;
	readonly groups: Readonly<Record<string, GroupMeasurement>>;
}

const sizeArbitrary: fc.Arbitrary<Size> = fc.record({
	width: fc.integer({ min: 1, max: 600 }),
	height: fc.integer({ min: 1, max: 300 }),
});
const groupMeasurementArbitrary: fc.Arbitrary<GroupMeasurement> = fc.record({
	minimumWidth: fc.integer({ min: 40, max: 400 }),
	minimumHeight: fc.integer({ min: 40, max: 240 }),
	headerHeight: fc.integer({ min: 1, max: 80 }),
	padding: fc.integer({ min: 1, max: 60 }),
});
const layoutConfigurationArbitrary: fc.Arbitrary<LayoutConfiguration> = fc.constantFrom(
	{ direction: LayoutDirection.TopToBottom, bias: LayoutBias.Top },
	{ direction: LayoutDirection.BottomToTop, bias: LayoutBias.Bottom },
	{ direction: LayoutDirection.LeftToRight, bias: LayoutBias.Left },
	{ direction: LayoutDirection.RightToLeft, bias: LayoutBias.Right },
);

const MULTI_COMPONENT_IDS = ['a-source', 'a-target', 'b-isolated', 'c-source', 'c-target'] as const;
const MULTI_COMPONENTS = [
	['a-source', 'a-target'],
	['b-isolated'],
	['c-source', 'c-target'],
] as const;
const GROUP_IDS = ['branch-a', 'branch-a-child', 'branch-b', 'branch-b-child'] as const;
const JUNCTION_NODE_IDS = ['source-a', 'source-b', 'target-a', 'target-b'] as const;
const JUNCTION_IDS = ['merge', 'terminal'] as const;

function requiredAt<T>(values: readonly T[], index: number, description: string): T {
	const value = values[index];
	if (value === undefined) throw new Error(`Missing generated ${description}: ${index}`);
	return value;
}

function generatedNode(id: string, groupId?: string): LogicNode {
	const node: LogicNode & { groupId?: string } = {
		kind: EndpointKind.Node,
		layoutOrder: orderKey(`a00${id.charCodeAt(0)}1`),
		id,
		natureId: 'generated',
		markdown: id,
	};
	if (groupId !== undefined) node.groupId = groupId;
	return node;
}

function generatedJunction(id: string): LogicJunction {
	return {
		kind: EndpointKind.Junction,
		id,
		operator: JunctionOperator.Xor,
		layoutOrder: orderKey(`b00${id.length}1`),
	};
}

function generatedGroup(id: string, label: string, groupId?: string): LogicGroup {
	let order = 2;
	if (id.includes('branch-a')) order = 1;
	const group: LogicGroup & { groupId?: string } = {
		kind: EndpointKind.Group,
		id,
		label,
		layoutOrder: orderKey(`c00${order}1`),
	};
	if (groupId !== undefined) group.groupId = groupId;
	return group;
}

function generatedDocument(
	layout: LayoutConfiguration,
	nodes: readonly LogicNode[],
	junctions: readonly LogicJunction[],
	relations: readonly LogicRelation[],
	groups: readonly LogicGroup[] = [],
): LogicDocument {
	return {
		persistenceFormat: PERSISTENCE_FORMAT,
		id: 'generated-component-document',
		title: 'Generated component document',
		layout,
		natures: [{ id: 'generated', label: 'Generated', color: '#000000' }],
		groups,
		nodes,
		junctions,
		relations,
	};
}

function valuesById<T>(
	ids: readonly string[],
	values: readonly T[],
	description: string,
): Readonly<Record<string, T>> {
	return Object.fromEntries(
		ids.map((id, index) => [id, requiredAt(values, index, `${description} ${id}`)]),
	);
}

function overridesFor(generated: ComponentCase) {
	return {
		nodes: generated.nodes,
		junctions: generated.junctions,
		groups: generated.groups,
	};
}

const multiComponentCaseArbitrary: fc.Arbitrary<ComponentCase> = fc
	.tuple(
		layoutConfigurationArbitrary,
		fc.array(sizeArbitrary, {
			minLength: MULTI_COMPONENT_IDS.length,
			maxLength: MULTI_COMPONENT_IDS.length,
		}),
	)
	.map(([layout, sizes]) => ({
		document: generatedDocument(
			layout,
			MULTI_COMPONENT_IDS.map((id) => generatedNode(id)),
			[],
			[
				{ id: 'a-relation', from: 'a-source', to: 'a-target' },
				{ id: 'c-relation', from: 'c-source', to: 'c-target' },
			],
		),
		nodes: valuesById(MULTI_COMPONENT_IDS, sizes, 'node size'),
		junctions: {},
		groups: {},
	}));

const groupBranchCaseArbitrary: fc.Arbitrary<ComponentCase> = fc
	.tuple(
		layoutConfigurationArbitrary,
		fc.array(sizeArbitrary, { minLength: 2, maxLength: 2 }),
		fc.array(groupMeasurementArbitrary, {
			minLength: GROUP_IDS.length,
			maxLength: GROUP_IDS.length,
		}),
	)
	.map(([layout, nodeSizes, groupMeasurements]) => ({
		document: generatedDocument(
			layout,
			[
				generatedNode('z-branch-a-node', 'branch-a-child'),
				generatedNode('a-branch-b-node', 'branch-b-child'),
			],
			[],
			[],
			[
				generatedGroup('branch-a', 'Branch A'),
				generatedGroup('branch-a-child', 'Branch A child', 'branch-a'),
				generatedGroup('branch-b', 'Branch B'),
				generatedGroup('branch-b-child', 'Branch B child', 'branch-b'),
			],
		),
		nodes: valuesById(['z-branch-a-node', 'a-branch-b-node'], nodeSizes, 'node size'),
		junctions: {},
		groups: valuesById(GROUP_IDS, groupMeasurements, 'group measurement'),
	}));

const junctionCaseArbitrary: fc.Arbitrary<ComponentCase> = fc
	.tuple(
		layoutConfigurationArbitrary,
		fc.array(sizeArbitrary, {
			minLength: JUNCTION_NODE_IDS.length,
			maxLength: JUNCTION_NODE_IDS.length,
		}),
		fc.array(sizeArbitrary, {
			minLength: JUNCTION_IDS.length,
			maxLength: JUNCTION_IDS.length,
		}),
	)
	.map(([layout, nodeSizes, junctionSizes]) => ({
		document: generatedDocument(
			layout,
			JUNCTION_NODE_IDS.map((id) => generatedNode(id)),
			JUNCTION_IDS.map((id) => generatedJunction(id)),
			[
				{ id: 'source-a-to-merge', from: 'source-a', to: 'merge' },
				{ id: 'source-b-to-merge', from: 'source-b', to: 'merge' },
				{ id: 'merge-to-target-a', from: 'merge', to: 'target-a' },
				{ id: 'merge-to-target-b', from: 'merge', to: 'target-b' },
				{ id: 'target-a-to-terminal', from: 'target-a', to: 'terminal' },
			],
		),
		nodes: valuesById(JUNCTION_NODE_IDS, nodeSizes, 'node size'),
		junctions: valuesById(JUNCTION_IDS, junctionSizes, 'junction size'),
		groups: {},
	}));

function envelopeFor(layout: LayoutResult, ids: readonly string[]): Bounds {
	let left = Number.POSITIVE_INFINITY;
	let top = Number.POSITIVE_INFINITY;
	let right = Number.NEGATIVE_INFINITY;
	let bottom = Number.NEGATIVE_INFINITY;
	for (const id of ids) {
		const bounds = boundsFor(layout, id);
		left = Math.min(left, bounds.x);
		top = Math.min(top, bounds.y);
		right = Math.max(right, bounds.x + bounds.width);
		bottom = Math.max(bottom, bounds.y + bounds.height);
	}
	return { x: left, y: top, width: right - left, height: bottom - top };
}

function crossPrecedes(
	left: Bounds,
	right: Bounds,
	direction: LayoutConfiguration['direction'],
): boolean {
	if (direction === LayoutDirection.TopToBottom || direction === LayoutDirection.BottomToTop) {
		return left.x + left.width < right.x;
	}
	return left.y + left.height < right.y;
}

function expectOrderedComponents(
	layout: LayoutResult,
	direction: LayoutConfiguration['direction'],
	components: readonly (readonly string[])[],
): void {
	const envelopes = components.map((ids) => envelopeFor(layout, ids));
	for (let index = 1; index < envelopes.length; index += 1) {
		const previous = requiredAt(envelopes, index - 1, 'previous envelope');
		const current = requiredAt(envelopes, index, 'current envelope');
		expect(overlaps(previous, current)).toBe(false);
		expect(crossPrecedes(previous, current, direction)).toBe(true);
	}
}

function reversedCollections(document: LogicDocument): LogicDocument {
	return {
		...document,
		natures: [...document.natures].reverse(),
		groups: [...document.groups].reverse(),
		nodes: [...document.nodes].reverse(),
		junctions: [...document.junctions].reverse(),
		relations: [...document.relations].reverse(),
	};
}

function scaledSizes(
	values: Readonly<Record<string, Size>>,
	factor: number,
): Readonly<Record<string, Size>> {
	return Object.fromEntries(
		Object.entries(values).map(([id, size]) => [
			id,
			{ width: size.width * factor, height: size.height * factor },
		]),
	);
}

// Measured alone: 9.6–9.8 s for the 200 default runs, about 50 ms each. The 5,000 fuzz runs of the
// same seed sum to 286 s under load (one draw takes 90 s): the ceiling follows the run count. After
// the wave-2 merge into main, the full coverage gate (four workers, three passes) took 25.4-27.6 s,
// hence 225 ms per run (user decision 2026-10-02). After the group-repair performance slice
// (2026-10-03), the same gate takes 12.8-14.7 s: ceil(14.73 * 1.5 / 5) * 5 = 25 s for 200 runs,
// hence 125 ms per run.
const PASSAGE_PROPERTY_TIMEOUT = PROPERTY_PARAMETERS.numRuns * 125;

describe('dedicated layout components', () => {
	// Bounded by size: the census of 300 twelve-node documents in four directions is the opt-in
	// profile performance/dedicated-group-routing-profile.test.ts (see the 2026-09-24 journal).
	it(
		'renders randomly grouped nodes and junctions without a passage failure',
		() => {
			fc.assert(
				fc.property(
					richAcyclicLogicDocumentArbitrary({ maxNodes: 8 }),
					fc.constantFrom(...Object.values(LayoutDirection)),
					(document, direction) => {
						const prepared = prepareLayoutDocument({
							...document,
							layout: defined(
								layoutConfiguration(direction, LayoutBias.Top) ??
									layoutConfiguration(direction, LayoutBias.Left),
							),
						});
						const { layout, witness } = layoutWithDedicatedEngineAndRankOrderWitness(
							prepared.graph,
							prepared.ranks,
							prepared.measurements,
						);
						// A rejected documentary layout may stay published only when witnessed unverified.
						const validation = validateDedicatedCandidate({ ...prepared, layout });
						if (!validation.valid) expect(witness.unverified, JSON.stringify(validation)).toBe(1);
					},
				),
				PROPERTY_PARAMETERS,
			);
		},
		PASSAGE_PROPERTY_TIMEOUT,
	);

	it.each([
		{ direction: LayoutDirection.TopToBottom, bias: LayoutBias.Top },
		{ direction: LayoutDirection.BottomToTop, bias: LayoutBias.Bottom },
		{ direction: LayoutDirection.LeftToRight, bias: LayoutBias.Left },
		{ direction: LayoutDirection.RightToLeft, bias: LayoutBias.Right },
	] satisfies readonly LayoutConfiguration[])(
		'orders root-group contexts documentarily, then the virtual root in $direction',
		async (configuration) => {
			for (const [first, second] of [
				['b', 'a'],
				['été', 'hiver'],
				['~a', 'b'],
			] as const) {
				const document = generatedDocument(
					configuration,
					[
						generatedNode('first-member', first),
						generatedNode('second-member', second),
						generatedNode('free'),
					],
					[],
					[],
					[
						{ ...generatedGroup(first, 'First'), layoutOrder: orderKey('a0') },
						{ ...generatedGroup(second, 'Second'), layoutOrder: orderKey('a1') },
					],
				);
				const { layout } = await layoutDocument(document);
				expectOrderedComponents(layout, configuration.direction, [
					[first, 'first-member'],
					[second, 'second-member'],
					['free'],
				]);
			}
		},
	);

	it.each([
		{ direction: LayoutDirection.TopToBottom, bias: LayoutBias.Top },
		{ direction: LayoutDirection.BottomToTop, bias: LayoutBias.Bottom },
		{ direction: LayoutDirection.LeftToRight, bias: LayoutBias.Left },
		{ direction: LayoutDirection.RightToLeft, bias: LayoutBias.Right },
	] satisfies readonly LayoutConfiguration[])(
		'keeps empty root groups in documentary order after three free nodes in $direction',
		async (configuration) => {
			const document = generatedDocument(
				configuration,
				['free-a', 'free-b', 'free-c'].map((id) => generatedNode(id)),
				[],
				[],
				[
					{ ...generatedGroup('z-first', 'First'), layoutOrder: orderKey('a0') },
					{ ...generatedGroup('a-second', 'Second'), layoutOrder: orderKey('a1') },
				],
			);
			const { layout } = await layoutDocument(document);
			expect(
				crossPrecedes(
					boundsFor(layout, 'z-first'),
					boundsFor(layout, 'a-second'),
					configuration.direction,
				),
			).toBe(true);
		},
	);

	it('separates disconnected components with independently generated sizes', async () => {
		await fc.assert(
			fc.asyncProperty(multiComponentCaseArbitrary, async (generated) => {
				const { layout } = await layoutDocument(generated.document, overridesFor(generated));
				expectOrderedComponents(layout, generated.document.layout.direction, MULTI_COMPONENTS);
			}),
			PROPERTY_PARAMETERS,
		);
	});

	it('aligns the same global rank for every direction and opposite bias', async () => {
		await fc.assert(
			fc.asyncProperty(multiComponentCaseArbitrary, async (generated) => {
				const { document, layout } = await layoutDocument(
					generated.document,
					overridesFor(generated),
				);
				const coordinates = ['a-target', 'b-isolated', 'c-target'].map((id) =>
					coordinateAt(boundsFor(layout, id), document.layout.bias),
				);
				expect(new Set(coordinates).size).toBe(1);
			}),
			PROPERTY_PARAMETERS,
		);
	});

	it('is invariant to permutations of disconnected component collections', async () => {
		await fc.assert(
			fc.asyncProperty(multiComponentCaseArbitrary, async (generated) => {
				const original = await layoutDocument(generated.document, overridesFor(generated));
				const reordered = await layoutDocument(
					reversedCollections(generated.document),
					overridesFor(generated),
				);
				expect(reordered.layout).toEqual(original.layout);
			}),
			PROPERTY_PARAMETERS,
		);
	});

	it.each([
		{ direction: LayoutDirection.LeftToRight, bias: LayoutBias.Left },
		{ direction: LayoutDirection.TopToBottom, bias: LayoutBias.Top },
	] satisfies readonly LayoutConfiguration[])(
		'preserves branch order despite large group insets in $direction',
		async (configuration) => {
			const document = generatedDocument(
				configuration,
				[
					generatedNode('z-branch-a-node', 'branch-a-child'),
					generatedNode('a-branch-b-node', 'branch-b-child'),
				],
				[],
				[],
				[
					generatedGroup('branch-a', 'Branch A'),
					generatedGroup('branch-a-child', 'Branch A child', 'branch-a'),
					generatedGroup('branch-b', 'Branch B'),
					generatedGroup('branch-b-child', 'Branch B child', 'branch-b'),
				],
			);
			const smallGroup = { minimumWidth: 40, minimumHeight: 40, headerHeight: 1, padding: 1 };
			const largeInsets = { ...smallGroup, headerHeight: 38, padding: 60 };
			const { layout } = await layoutDocument(document, {
				nodes: {
					'z-branch-a-node': { width: 1, height: 1 },
					'a-branch-b-node': { width: 1, height: 1 },
				},
				groups: {
					'branch-a': smallGroup,
					'branch-a-child': smallGroup,
					'branch-b': largeInsets,
					'branch-b-child': largeInsets,
				},
			});
			expectOrderedComponents(layout, configuration.direction, [
				['branch-a', 'branch-a-child', 'z-branch-a-node'],
				['branch-b', 'branch-b-child', 'a-branch-b-node'],
			]);
		},
	);

	it('orders and contains disconnected branches of the group hierarchy', async () => {
		await fc.assert(
			fc.asyncProperty(groupBranchCaseArbitrary, async (generated) => {
				const { document, layout } = await layoutDocument(
					generated.document,
					overridesFor(generated),
				);
				const branchA = boundsFor(layout, 'branch-a');
				const branchB = boundsFor(layout, 'branch-b');
				expect(contains(branchA, boundsFor(layout, 'branch-a-child'))).toBe(true);
				expect(contains(branchB, boundsFor(layout, 'branch-b-child'))).toBe(true);
				expect(
					contains(boundsFor(layout, 'branch-a-child'), boundsFor(layout, 'z-branch-a-node')),
				).toBe(true);
				expect(
					contains(boundsFor(layout, 'branch-b-child'), boundsFor(layout, 'a-branch-b-node')),
				).toBe(true);
				expect(overlaps(branchA, branchB)).toBe(false);
				expect(crossPrecedes(branchA, branchB, document.layout.direction)).toBe(true);
			}),
			PROPERTY_PARAMETERS,
		);
	});

	it('progresses through generated fan-in, fan-out and terminal junctions', async () => {
		await fc.assert(
			fc.asyncProperty(junctionCaseArbitrary, async (generated) => {
				const { document, layout } = await layoutDocument(
					generated.document,
					overridesFor(generated),
				);
				for (const relation of layout.relations) {
					expect(
						progressesFromTo(
							boundsFor(layout, relation.to),
							boundsFor(layout, relation.from),
							document.layout.direction,
						),
						`${relation.to} does not precede its child ${relation.from}`,
					).toBe(true);
				}
			}),
			PROPERTY_PARAMETERS,
		);
	});

	it('preserves component separation when every endpoint size is scaled', async () => {
		await fc.assert(
			fc.asyncProperty(
				multiComponentCaseArbitrary,
				fc.integer({ min: 2, max: 4 }),
				async (generated, factor) => {
					const original = await layoutDocument(generated.document, overridesFor(generated));
					const scaled = await layoutDocument(generated.document, {
						nodes: scaledSizes(generated.nodes, factor),
						junctions: {},
						groups: {},
					});
					for (const id of MULTI_COMPONENT_IDS) {
						const before = boundsFor(original.layout, id);
						const after = boundsFor(scaled.layout, id);
						const intrinsic = generated.nodes[id];
						if (intrinsic === undefined) throw new Error(`Missing node size ${id}`);
						const incident = generated.document.relations.some(
							({ from, to }) => from === id || to === id,
						);
						if (
							incident &&
							[LayoutDirection.TopToBottom, LayoutDirection.BottomToTop].includes(
								generated.document.layout.direction,
							)
						) {
							expect(before.width).toBe(Math.max(intrinsic.width, 2 * PORT_INSET));
							expect(after.width).toBe(Math.max(intrinsic.width * factor, 2 * PORT_INSET));
						} else expect(after.width).toBe(before.width * factor);
						if (
							incident &&
							[LayoutDirection.LeftToRight, LayoutDirection.RightToLeft].includes(
								generated.document.layout.direction,
							)
						) {
							expect(before.height).toBe(Math.max(intrinsic.height, 2 * PORT_INSET));
							expect(after.height).toBe(Math.max(intrinsic.height * factor, 2 * PORT_INSET));
						} else expect(after.height).toBe(before.height * factor);
					}
					expectOrderedComponents(
						scaled.layout,
						generated.document.layout.direction,
						MULTI_COMPONENTS,
					);
				},
			),
			PROPERTY_PARAMETERS,
		);
	});
});
