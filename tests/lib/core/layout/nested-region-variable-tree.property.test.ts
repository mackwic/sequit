import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
	layoutGraph,
	layoutGraphForProjection,
} from '../../../../src/app/web/projection/layout-graph';
import {
	defined,
	EndpointKind,
	LAYOUT_DIRECTIONS,
	layoutConfiguration,
	LayoutPolicy,
	type LogicDocument,
	type LogicRelation,
	REGION_PERSISTENCE_FORMAT,
	REGION_PRESENTATION_SCHEMA,
} from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import { ROOT_LAYOUT_REGION_ID } from '../../../../src/lib/core/document/region-presentation';
import type {
	Bounds,
	LayoutMeasurements,
	LayoutResult,
	Point,
	Size,
} from '../../../../src/lib/core/layout/layout-types';
import { validateNestedRegionGeometry } from '../../../../src/lib/core/layout/nested-region-geometry';
import {
	solveNestedRegionLayout,
	solveNestedRegionLayoutForProjection,
} from '../../../../src/lib/core/layout/nested-region-layout';
import { validateNestedRegionLeafIncidentsMessage as validateNestedRegionLeafIncidents } from '../../../../src/lib/core/layout/nested-region-leaf-incident-validation';
import {
	normalizeRegionCompositionModel,
	RegionCompositionModelStatus,
} from '../../../../src/lib/core/layout/region-composition-model';
import {
	RegionCompositionStatus,
	type RegionInput,
	type RegionLayoutSelected,
} from '../../../../src/lib/core/layout/region-composition-types';
import { validateRegionCompositionGeometryMessage as validateRegionCompositionGeometry } from '../../../../src/lib/core/layout/region-composition-validation';
import { RegionLocalLayoutCache } from '../../../../src/lib/core/layout/region-local-cache';
import { UnknownRegionLayoutError } from '../../../../src/lib/core/layout/root-region';
import { PROPERTY_PARAMETERS } from '../../../support/builders/property-test-options';
import { prepareLayoutDocument } from '../../../support/harnesses/layout';
import { defaultBiasFor } from '../../../support/harnesses/visual-directions';

type Depth = 1 | 2 | 3;
type BranchWidth = 2 | 3;
type NestedParents = 0 | 1 | 2 | 3;
type CrossingScope = 'root' | 'branch' | 'between-branches';

interface TreeCase {
	readonly depth: Depth;
	readonly rootChildren: BranchWidth;
	readonly nestedParents: NestedParents;
	readonly grandchildren: readonly [BranchWidth, BranchWidth, BranchWidth];
	readonly crossingScope: CrossingScope;
	readonly firstLeafPair: boolean;
	readonly direction: (typeof LAYOUT_DIRECTIONS)[number];
	readonly sizes: readonly Size[];
}

interface BuiltTree {
	readonly document: LogicDocument;
	readonly input: RegionInput;
	readonly sizesById: Readonly<Record<string, Size>>;
}

const branchWidth = fc.constantFrom(2 as const, 3 as const);
const fractionalSize = fc.record({
	width: fc.integer({ min: 80, max: 280 }).map((value) => value + 0.25),
	height: fc.integer({ min: 40, max: 140 }).map((value) => value + 0.5),
});

function treeCases(depth: Depth, crossingScope: CrossingScope): fc.Arbitrary<TreeCase> {
	let nestedParents: fc.Arbitrary<NestedParents> = fc.constant(0);
	if (depth === 2) nestedParents = fc.constantFrom(1 as const, 2 as const);
	if (depth === 3) nestedParents = fc.constantFrom(1 as const, 2 as const, 3 as const);
	if (crossingScope === 'between-branches' && depth === 2) nestedParents = fc.constant(2);
	if (crossingScope === 'between-branches' && depth === 3)
		nestedParents = fc.constantFrom(2 as const, 3 as const);
	let grandchildren: fc.Arbitrary<readonly [BranchWidth, BranchWidth, BranchWidth]> = fc.constant([
		2, 2, 2,
	]);
	if (depth >= 2) grandchildren = fc.tuple(branchWidth, branchWidth, branchWidth);
	let firstLeafPair: fc.Arbitrary<boolean> = fc.boolean();
	if (crossingScope === 'between-branches') firstLeafPair = fc.constant(false);
	return fc
		.record({
			depth: fc.constant(depth),
			rootChildren: branchWidth,
			nestedParents,
			grandchildren,
			crossingScope: fc.constant(crossingScope),
			firstLeafPair,
			direction: fc.constantFrom(...LAYOUT_DIRECTIONS),
			sizes: fc.array(fractionalSize, { minLength: 12, maxLength: 12 }),
		})
		.filter(({ rootChildren, nestedParents }) => nestedParents <= rootChildren);
}

function buildTree(sample: TreeCase): BuiltTree {
	const definitions: NonNullable<LogicDocument['regionPresentation']>['regions'][number][] = [];
	const leaves: string[] = [];
	const firstBranchLeaves: string[] = [];
	const secondBranchLeaves: string[] = [];
	for (let parentIndex = 0; parentIndex < sample.rootChildren; parentIndex += 1) {
		const parentId = `r${parentIndex}`;
		definitions.push({
			id: parentId,
			layoutOrder: orderKey(`a${parentIndex}`),
			policy: LayoutPolicy.Layered,
		});
		if (parentIndex >= sample.nestedParents) {
			leaves.push(parentId);
			continue;
		}
		const width = defined(sample.grandchildren[parentIndex]);
		for (let childIndex = 0; childIndex < width; childIndex += 1) {
			const leafId = `${parentId}-c${childIndex}`;
			definitions.push({
				id: leafId,
				parentId,
				layoutOrder: orderKey(`a${childIndex}`),
				policy: LayoutPolicy.Layered,
			});
			if (sample.depth === 3 && childIndex === 0 && parentIndex < 2) {
				for (let descendantIndex = 0; descendantIndex < 2; descendantIndex += 1) {
					const descendantId = `${leafId}-d${descendantIndex}`;
					definitions.push({
						id: descendantId,
						parentId: leafId,
						layoutOrder: orderKey(`a${descendantIndex}`),
						policy: LayoutPolicy.Layered,
					});
					leaves.push(descendantId);
					if (parentIndex === 0) firstBranchLeaves.push(descendantId);
					if (parentIndex === 1) secondBranchLeaves.push(descendantId);
				}
				continue;
			}
			leaves.push(leafId);
			if (parentIndex === 0) firstBranchLeaves.push(leafId);
			if (parentIndex === 1) secondBranchLeaves.push(leafId);
		}
	}
	const nodes = leaves.flatMap((regionId, leafIndex) => {
		let count = 1;
		if (leafIndex === 0 && sample.firstLeafPair) count = 2;
		return Array.from({ length: count }, (_, localIndex) => ({
			kind: EndpointKind.Node as const,
			id: `${regionId}-n${localIndex}`,
			natureId: 'task',
			markdown: `Node ${regionId}-${localIndex}\n`,
			layoutOrder: orderKey(`a${localIndex}`),
			regionId,
		}));
	});
	const first = defined(leaves[0]);
	let target = defined(leaves.at(-1));
	if (sample.crossingScope === 'branch') target = defined(firstBranchLeaves.at(-1));
	if (sample.crossingScope === 'between-branches') {
		target = defined(secondBranchLeaves.at(-1));
		if (sample.depth === 3) target = defined(secondBranchLeaves[0]);
	}
	let sourceIndex = 0;
	const relations: LogicRelation[] = [];
	if (sample.firstLeafPair) {
		sourceIndex = 1;
		relations.push({
			id: 'inside-first',
			from: `${first}-n0`,
			to: `${first}-n1`,
		});
	}
	relations.push({
		id: 'across-tree',
		from: `${first}-n${sourceIndex}`,
		to: `${target}-n0`,
	});
	const document: LogicDocument = {
		persistenceFormat: REGION_PERSISTENCE_FORMAT,
		id: 'variable-region-tree',
		title: 'Variable region tree',
		layout: defined(layoutConfiguration(sample.direction, defaultBiasFor(sample.direction))),
		natures: [{ id: 'task', label: 'Task', color: '#304050' }],
		groups: [],
		junctions: [],
		nodes,
		relations,
		regionPresentation: {
			schemaVersion: REGION_PRESENTATION_SCHEMA,
			regions: definitions,
		},
	};
	const input: RegionInput = {
		regions: [
			{ id: ROOT_LAYOUT_REGION_ID, layoutOrder: 'a0' },
			...definitions.map(({ id, parentId, layoutOrder, policy }) => ({
				id,
				parentId: parentId ?? ROOT_LAYOUT_REGION_ID,
				layoutOrder,
				policy,
			})),
		],
		regionByEndpointId: new Map(nodes.map(({ id, regionId }) => [id, regionId])),
	};
	const sizesById = Object.fromEntries(
		nodes.map(({ id }, index) => [id, defined(sample.sizes[index])]),
	);
	return { document, input, sizesById };
}

function permutedTree(tree: BuiltTree): BuiltTree {
	const presentation = defined(tree.document.regionPresentation);
	return {
		...tree,
		document: {
			...tree.document,
			regionPresentation: {
				...presentation,
				regions: [...presentation.regions].reverse(),
			},
			nodes: [...tree.document.nodes].reverse(),
			relations: [...tree.document.relations].reverse(),
		},
		input: {
			regions: [...tree.input.regions].reverse(),
			regionByEndpointId: new Map([...tree.input.regionByEndpointId].reverse()),
		},
	};
}

function reversedMeasurements(measurements: LayoutMeasurements): LayoutMeasurements {
	return { ...measurements, nodes: new Map([...measurements.nodes].reverse()) };
}

function contained(outer: Bounds, inner: Bounds): boolean {
	return (
		inner.x >= outer.x &&
		inner.y >= outer.y &&
		inner.x + inner.width <= outer.x + outer.width &&
		inner.y + inner.height <= outer.y + outer.height
	);
}

function segmentEntersOpenBox(start: Point, end: Point, box: Bounds): boolean {
	if (start.x === end.x)
		return (
			start.x > box.x &&
			start.x < box.x + box.width &&
			Math.max(start.y, end.y) > box.y &&
			Math.min(start.y, end.y) < box.y + box.height
		);
	if (start.y === end.y)
		return (
			start.y > box.y &&
			start.y < box.y + box.height &&
			Math.max(start.x, end.x) > box.x &&
			Math.min(start.x, end.x) < box.x + box.width
		);
	return true;
}

function verifyPublicGeometry(layout: LayoutResult, tree: BuiltTree): void {
	const regions = new Map(defined(layout.regions).map(({ id, bounds }) => [id, bounds]));
	const parents = new Map(tree.input.regions.map(({ id, parentId }) => [id, parentId]));
	for (const region of tree.input.regions) {
		const parentId = region.parentId;
		if (parentId === undefined || parentId === ROOT_LAYOUT_REGION_ID) continue;
		expect(contained(defined(regions.get(parentId)), defined(regions.get(region.id)))).toBe(true);
	}
	for (const node of tree.document.nodes) {
		const frame = defined(regions.get(defined(node.regionId)));
		const element = defined(layout.elements.find(({ id }) => id === node.id));
		expect(contained(frame, element.bounds)).toBe(true);
	}
	const crossing = defined(layout.relations.find(({ id }) => id === 'across-tree'));
	const fromRegion = defined(tree.input.regionByEndpointId.get(crossing.from));
	const toRegion = defined(tree.input.regionByEndpointId.get(crossing.to));
	const incidentRegions = new Set<string>();
	for (const endpointRegion of [fromRegion, toRegion]) {
		let current: string | undefined = endpointRegion;
		while (current !== undefined) {
			incidentRegions.add(current);
			current = parents.get(current);
		}
	}
	for (const [regionId, frame] of regions) {
		if (incidentRegions.has(regionId)) continue;
		for (let index = 1; index < crossing.points.length; index += 1) {
			const start = defined(crossing.points[index - 1]);
			const end = defined(crossing.points[index]);
			expect(segmentEntersOpenBox(start, end, frame)).toBe(false);
		}
	}
}

function verifyBoundaryChain(
	result: RegionLayoutSelected,
	tree: BuiltTree,
	sample: TreeCase,
): void {
	const relation = defined(tree.document.relations.find(({ id }) => id === 'across-tree'));
	const parents = new Map(tree.input.regions.map(({ id, parentId }) => [id, parentId]));
	const ancestors = (endpointId: string): string[] => {
		const path: string[] = [];
		let current: string | undefined = defined(tree.input.regionByEndpointId.get(endpointId));
		while (current !== undefined) {
			path.push(current);
			current = parents.get(current);
		}
		return path;
	};
	const sourcePath = ancestors(relation.from);
	const targetPath = ancestors(relation.to);
	const lca = defined(sourcePath.find((regionId) => targetPath.includes(regionId)));
	const sourceOwners = sourcePath.slice(0, sourcePath.indexOf(lca));
	const targetOwners = targetPath.slice(0, targetPath.indexOf(lca)).reverse();
	const owners = result.ownedRoutes.filter(({ relationId }) => relationId === relation.id);
	const portals = result.portals.filter(({ relationId }) => relationId === relation.id);
	expect(owners.map(({ regionId }) => regionId)).toEqual([...sourceOwners, lca, ...targetOwners]);
	expect(portals.map(({ regionId, endpointId }) => [regionId, endpointId])).toEqual([
		...sourceOwners.map((regionId) => [regionId, relation.from]),
		...targetOwners.map((regionId) => [regionId, relation.to]),
	]);
	if (sample.crossingScope === 'between-branches') {
		let expectedPortals = 4;
		let expectedOwners = 5;
		if (sample.depth === 3) {
			expectedPortals = 6;
			expectedOwners = 7;
		}
		expect(portals).toHaveLength(expectedPortals);
		expect(owners).toHaveLength(expectedOwners);
	}
}

async function checkCase(sample: TreeCase): Promise<void> {
	const tree = buildTree(sample);
	expect(tree.document.nodes.length).toBeLessThanOrEqual(12);
	const prepared = prepareLayoutDocument(tree.document, {
		nodes: tree.sizesById,
	});
	const first = solveNestedRegionLayout(prepared.graph, prepared.measurements, tree.input);
	const permuted = permutedTree(tree);
	const secondPrepared = prepareLayoutDocument(permuted.document, {
		nodes: permuted.sizesById,
	});
	const secondMeasurements = reversedMeasurements(secondPrepared.measurements);
	const second = solveNestedRegionLayout(secondPrepared.graph, secondMeasurements, permuted.input);
	expect(second).toEqual(first);
	expect(first.status).not.toBe(RegionCompositionStatus.Unsupported);
	if (first.status === RegionCompositionStatus.Unknown) {
		expect(sample.depth).toBe(2);
		expect(sample.crossingScope).toBe('root');
		expect(sample.firstLeafPair).toBe(true);
		await expect(
			layoutGraph(prepared.graph, prepared.ranks, prepared.measurements),
		).rejects.toMatchObject({
			name: UnknownRegionLayoutError.name,
			reason: first.reason,
		});
		await expect(
			layoutGraph(secondPrepared.graph, secondPrepared.ranks, secondMeasurements),
		).rejects.toMatchObject({
			name: UnknownRegionLayoutError.name,
			reason: first.reason,
		});
		return;
	}
	expect(first.status).toBe(RegionCompositionStatus.Selected);
	if (first.status !== RegionCompositionStatus.Selected) return;
	expect(validateNestedRegionGeometry(prepared.graph, tree.input, first)).toBeUndefined();
	verifyBoundaryChain(first, tree, sample);
	const layout = await layoutGraph(prepared.graph, prepared.ranks, prepared.measurements);
	const reversedLayout = await layoutGraph(
		secondPrepared.graph,
		secondPrepared.ranks,
		secondMeasurements,
	);
	expect(reversedLayout).toEqual(layout);
	expect(layout).toEqual({
		...first.layout,
		regions: first.regions.map(({ id, bounds }) => ({ id, bounds })),
	});
	verifyPublicGeometry(layout, tree);
}

const editKinds = ['resize', 'local-relation', 'cross-relation', 'permutation'] as const;
type EditKind = (typeof editKinds)[number];
type LocalEdit = 'remove' | 'rename' | 'reverse';
type CrossEdit = 'add' | 'remove' | 'retarget';

interface SequenceCase {
	readonly tree: TreeCase;
	readonly order: readonly EditKind[];
	readonly resizeDelta: number;
	readonly localEdit: LocalEdit;
	readonly crossEdit: CrossEdit;
}

const sequenceCases: fc.Arbitrary<SequenceCase> = fc.record({
	tree: fc
		.oneof(
			treeCases(1, 'root'),
			treeCases(2, 'branch'),
			treeCases(2, 'root'),
			treeCases(2, 'between-branches'),
			treeCases(3, 'root'),
			treeCases(3, 'between-branches'),
		)
		.map((tree) => ({ ...tree, firstLeafPair: true })),
	order: fc.shuffledSubarray([...editKinds], {
		minLength: editKinds.length,
		maxLength: editKinds.length,
	}),
	resizeDelta: fc.integer({ min: 1, max: 40 }),
	localEdit: fc.constantFrom<LocalEdit>('remove', 'rename', 'reverse'),
	crossEdit: fc.constantFrom<CrossEdit>('add', 'remove', 'retarget'),
});

function applySequenceEdit(tree: BuiltTree, sample: SequenceCase, edit: EditKind): BuiltTree {
	if (edit === 'permutation') return permutedTree(tree);
	if (edit === 'resize') {
		const endpointId = defined(tree.document.nodes.find(({ id }) => id.endsWith('-n0'))).id;
		const previous = defined(tree.sizesById[endpointId]);
		return {
			...tree,
			sizesById: {
				...tree.sizesById,
				[endpointId]: {
					width: previous.width + sample.resizeDelta + 0.25,
					height: previous.height + sample.resizeDelta / 2 + 0.5,
				},
			},
		};
	}
	if (edit === 'local-relation')
		return {
			...tree,
			document: {
				...tree.document,
				relations: tree.document.relations.flatMap((relation) => {
					if (relation.id !== 'inside-first') return [relation];
					if (sample.localEdit === 'remove') return [];
					if (sample.localEdit === 'rename') return [{ ...relation, id: 'inside-first-edited' }];
					return [{ ...relation, from: relation.to, to: relation.from }];
				}),
			},
		};
	const crossing = defined(tree.document.relations.find(({ id }) => id === 'across-tree'));
	const firstLeaf = defined(tree.input.regionByEndpointId.get(crossing.from));
	let relations: readonly LogicRelation[] = tree.document.relations;
	if (sample.crossEdit === 'remove') relations = relations.filter(({ id }) => id !== crossing.id);
	if (sample.crossEdit === 'retarget')
		relations = relations.map((relation) => {
			if (relation.id === crossing.id) return { ...relation, from: `${firstLeaf}-n0` };
			return relation;
		});
	if (sample.crossEdit === 'add')
		relations = [
			...relations,
			{ id: 'across-tree-extra', from: `${firstLeaf}-n0`, to: crossing.to },
		];
	return { ...tree, document: { ...tree.document, relations } };
}

async function checkSequenceCase(sample: SequenceCase): Promise<void> {
	const cache = new RegionLocalLayoutCache();
	let tree = buildTree(sample.tree);
	let previous: ReturnType<typeof solveNestedRegionLayoutForProjection> | undefined;
	let completedEdits: readonly EditKind[] = [];
	for (const edit of [undefined, ...sample.order]) {
		if (edit !== undefined) {
			tree = applySequenceEdit(tree, sample, edit);
			completedEdits = [...completedEdits, edit];
		}
		try {
			const prepared = prepareLayoutDocument(tree.document, {
				nodes: tree.sizesById,
			});
			let measurements = prepared.measurements;
			if (edit === 'permutation') measurements = reversedMeasurements(measurements);
			const incremental = solveNestedRegionLayoutForProjection(
				prepared.graph,
				measurements,
				tree.input,
				cache,
			);
			const cold = solveNestedRegionLayout(prepared.graph, measurements, tree.input);
			expect(incremental).toEqual(cold);
			expect(incremental.status).not.toBe(RegionCompositionStatus.Unsupported);
			if (edit === 'permutation') {
				expect(incremental).toEqual(previous);
			}
			previous = incremental;
			if (incremental.status === RegionCompositionStatus.Unknown) {
				expect(incremental.reason.length).toBeGreaterThan(0);
				await expect(
					layoutGraph(prepared.graph, prepared.ranks, measurements),
				).rejects.toMatchObject({
					name: UnknownRegionLayoutError.name,
					reason: incremental.reason,
				});
				await expect(
					layoutGraphForProjection(prepared.graph, prepared.ranks, measurements, cache),
				).rejects.toMatchObject({
					name: UnknownRegionLayoutError.name,
					reason: incremental.reason,
				});
				continue;
			}
			expect(incremental.status).toBe(RegionCompositionStatus.Selected);
			if (incremental.status !== RegionCompositionStatus.Selected) continue;
			const normalized = normalizeRegionCompositionModel(prepared.graph, tree.input);
			expect(normalized.status).toBe(RegionCompositionModelStatus.Ready);
			if (normalized.status !== RegionCompositionModelStatus.Ready) continue;
			expect(validateRegionCompositionGeometry(normalized.model, incremental)).toBeUndefined();
			expect(validateNestedRegionLeafIncidents(normalized.model, incremental)).toBeUndefined();
			const publicIncremental = await layoutGraphForProjection(
				prepared.graph,
				prepared.ranks,
				measurements,
				cache,
			);
			const publicCold = await layoutGraph(prepared.graph, prepared.ranks, measurements);
			expect(publicIncremental).toEqual(publicCold);
			expect(publicIncremental).toEqual({
				...incremental.layout,
				regions: incremental.regions.map(({ id, bounds }) => ({ id, bounds })),
			});
		} catch (error) {
			throw new Error(
				`Serialized recursive edit case: ${JSON.stringify({ sample, completedEdits, document: tree.document, sizesById: tree.sizesById })}`,
				{ cause: error },
			);
		}
	}
}

describe('variable persisted region trees through the production layout entry', () => {
	for (const configuration of [
		{ depth: 1, crossingScope: 'root' },
		{ depth: 2, crossingScope: 'branch' },
		{ depth: 2, crossingScope: 'root' },
		{ depth: 2, crossingScope: 'between-branches' },
		{ depth: 3, crossingScope: 'root' },
		{ depth: 3, crossingScope: 'between-branches' },
	] as const) {
		it(`checks depth ${configuration.depth} ${configuration.crossingScope} crossings with variable siblings`, async () => {
			await fc.assert(
				fc.asyncProperty(
					treeCases(configuration.depth, configuration.crossingScope),
					async (sample) => {
						try {
							await checkCase(sample);
						} catch (error) {
							throw new Error(`Serialized region case: ${JSON.stringify(sample)}`, {
								cause: error,
							});
						}
					},
				),
				PROPERTY_PARAMETERS,
			);
		});
	}
	it('matches cold composition through reordered local, crossing, size and collection edits', async () => {
		await fc.assert(fc.asyncProperty(sequenceCases, checkSequenceCase), PROPERTY_PARAMETERS);
	});
});
