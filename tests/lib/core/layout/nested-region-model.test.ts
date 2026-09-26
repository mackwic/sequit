import { describe, expect, it } from 'vitest';

import {
	EndpointKind,
	JunctionOperator,
	LANE_PERSISTENCE_FORMAT,
	LaneGrowth,
	LaneOrientation,
	LAYOUT_PRESENTATION_SCHEMA,
	LayoutBias,
	LayoutDirection,
	LayoutPolicy,
	type LogicDocument,
} from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import { solveNestedRegionLayout } from '../../../../src/lib/core/layout/nested-region-layout';
import {
	normalizeRegionCompositionModel,
	RegionCompositionModelStatus,
} from '../../../../src/lib/core/layout/regions/model/region-composition-model';
import {
	RegionCompositionStatus,
	type RegionInput,
} from '../../../../src/lib/core/layout/regions/model/region-composition-types';
import { validateNestedRegionLeafIncidents } from '../../../../src/lib/core/layout/regions/validation/nested-region-leaf-incident-validation';
import { validateRegionCompositionGeometry } from '../../../../src/lib/core/layout/regions/validation/region-composition-validation';
import { prepareLayoutDocument } from '../../../support/harnesses/layout';
import { nestedRegionInput, regionDocument } from './nested-region-fixture';

function solve(document: LogicDocument, regions: RegionInput) {
	const prepared = prepareLayoutDocument(document);
	return solveNestedRegionLayout(prepared.graph, prepared.measurements, regions);
}

describe('normalized child-region envelope', () => {
	it('accepts two real children and keeps a child-specific flow direction', () => {
		const document = regionDocument();
		const withoutMiddle = {
			...document,
			nodes: document.nodes.filter(({ id }) => id !== 'b'),
		};
		const regions = nestedRegionInput();
		const twoChildren = {
			regions: regions.regions.filter(({ id }) => id !== 'middle'),
			regionByEndpointId: new Map([...regions.regionByEndpointId].filter(([id]) => id !== 'b')),
		};
		const result = solve(withoutMiddle, twoChildren);
		expect(result.status).toBe(RegionCompositionStatus.Selected);
		if (result.status !== RegionCompositionStatus.Selected) return;
		expect(result.regions.map(({ id }) => id)).toEqual(['left', 'right']);
		expect(result.regions[1]?.localLayout.elements.map(({ id }) => id)).toEqual(['c']);
	});

	it.each([
		[
			'duplicate id',
			(value: RegionInput) => ({
				...value,
				regions: [...value.regions, { id: 'left', parentId: '@root', layoutOrder: 'a' }],
			}),
		],
		[
			'empty id',
			(value: RegionInput) => ({
				...value,
				regions: value.regions.map((region) => {
					if (region.id !== 'right') return region;
					return { ...region, id: '' };
				}),
			}),
		],
		[
			'two roots',
			(value: RegionInput) => ({
				...value,
				regions: value.regions.map((region) => {
					if (region.id !== 'right') return region;
					return { id: region.id, layoutOrder: region.layoutOrder };
				}),
			}),
		],
		['one child', (value: RegionInput) => ({ ...value, regions: value.regions.slice(0, 2) })],
		[
			'grandchild',
			(value: RegionInput) => ({
				...value,
				regions: value.regions.map((region) => {
					if (region.id !== 'right') return region;
					return { ...region, parentId: 'middle' };
				}),
			}),
		],
		[
			'unknown assignment',
			(value: RegionInput) => ({
				...value,
				regionByEndpointId: new Map([...value.regionByEndpointId, ['c', 'absent']]),
			}),
		],
		[
			'extra assignment',
			(value: RegionInput) => ({
				...value,
				regionByEndpointId: new Map([...value.regionByEndpointId, ['ghost', 'left']]),
			}),
		],
		[
			'empty child',
			(value: RegionInput) => ({
				...value,
				regionByEndpointId: new Map([...value.regionByEndpointId, ['b', 'right']]),
			}),
		],
	] as const)('returns unsupported for %s', (_, change) => {
		const result = solve(regionDocument(), change(nestedRegionInput()));
		expect(result.status).toBe(RegionCompositionStatus.Unsupported);
	});

	it('rejects unsupported graph constructs before child materialization', () => {
		const document = regionDocument();
		const withGroup: LogicDocument = {
			...document,
			groups: [{ kind: EndpointKind.Group, id: 'g', label: 'G', layoutOrder: orderKey('a4') }],
		};
		const withJunction: LogicDocument = {
			...document,
			junctions: [
				{
					kind: EndpointKind.Junction,
					id: 'j',
					operator: JunctionOperator.Xor,
					layoutOrder: orderKey('a4'),
				},
			],
		};
		expect(solve(withGroup, nestedRegionInput()).status).toBe(RegionCompositionStatus.Unsupported);
		expect(solve(withJunction, nestedRegionInput()).status).toBe(
			RegionCompositionStatus.Unsupported,
		);
		const withLanes: LogicDocument = {
			...document,
			persistenceFormat: LANE_PERSISTENCE_FORMAT,
			presentation: {
				schemaVersion: LAYOUT_PRESENTATION_SCHEMA,
				policy: LayoutPolicy.Layered,
				laneOrientation: LaneOrientation.Parallel,
				growth: LaneGrowth.Auto,
				lanes: [
					{ id: 'one', label: 'One', layoutOrder: orderKey('a0') },
					{ id: 'two', label: 'Two', layoutOrder: orderKey('a1') },
				],
			},
			nodes: document.nodes.map((node) => ({ ...node, laneId: 'one' })),
		};
		expect(solve(withLanes, nestedRegionInput()).status).toBe(RegionCompositionStatus.Unsupported);
	});

	it('keeps the explicit size envelope and canonical region tie-break', () => {
		const document = regionDocument();
		const template = document.nodes[0];
		if (template === undefined) throw new Error('Missing source fixture');
		const extraNodes = Array.from({ length: 9 }, (_, index) => ({
			...template,
			id: `extra-${index}`,
			layoutOrder: orderKey(`a${'456789ABC'.charAt(index)}`),
		}));
		const tooMany = { ...document, nodes: [...document.nodes, ...extraNodes] };
		expect(solve(tooMany, nestedRegionInput()).status).toBe(RegionCompositionStatus.Unsupported);
		const withinNodeBudget = [...document.nodes, ...extraNodes.slice(0, 6)];
		const relations = [] as LogicDocument['relations'][number][];
		for (let source = 0; source < withinNodeBudget.length; source += 1) {
			for (let target = source + 1; target < withinNodeBudget.length; target += 1) {
				if (relations.length >= 17) continue;
				const from = withinNodeBudget[source]?.id;
				const to = withinNodeBudget[target]?.id;
				if (from === undefined || to === undefined) continue;
				relations.push({ id: `relation-${source}-${target}`, from, to });
			}
		}
		const tooManyRelations = { ...document, nodes: withinNodeBudget, relations };
		expect(solve(tooManyRelations, nestedRegionInput()).status).toBe(
			RegionCompositionStatus.Unsupported,
		);
		const sameOrder = nestedRegionInput();
		const tied = {
			...sameOrder,
			regions: sameOrder.regions.map((region) => {
				if (region.parentId === undefined) return region;
				return { ...region, layoutOrder: 'x' };
			}),
		};
		const resolved = solve(document, tied);
		expect(resolved.status).toBe(RegionCompositionStatus.Selected);
		if (resolved.status !== RegionCompositionStatus.Selected) return;
		expect(resolved.regions.map(({ id }) => id)).toEqual(['left', 'middle', 'right']);
	});

	it('enforces the bounded inter-region route budget', () => {
		const document = regionDocument();
		const moreCrossings = {
			...document,
			relations: [
				...document.relations,
				{ id: 'a-to-b', from: 'a-target', to: 'b' },
				{ id: 'b-to-c', from: 'b', to: 'c' },
				{ id: 'a-to-c-again', from: 'a-source', to: 'c' },
			],
		};
		expect(solve(moreCrossings, nestedRegionInput()).status).toBe(
			RegionCompositionStatus.Unsupported,
		);
	});

	it('does not materialize a combined routing inspection', () => {
		const prepared = prepareLayoutDocument(regionDocument());
		const result = solveNestedRegionLayout(
			prepared.graph,
			prepared.measurements,
			nestedRegionInput(),
			{ inspectRouting: true },
		);
		expect(result.status).toBe(RegionCompositionStatus.Unsupported);
	});

	it('preserves the source graph when children choose their own direction', () => {
		const document = regionDocument();
		const regions = nestedRegionInput();
		const localLayout = {
			direction: LayoutDirection.BottomToTop,
			bias: LayoutBias.Bottom,
		} as const;
		const differentlyDirected = {
			...regions,
			regions: regions.regions.map((region) => {
				if (region.id !== 'left') return region;
				return { ...region, layout: localLayout };
			}),
		};
		const prepared = prepareLayoutDocument(document);
		const before = structuredClone(prepared.graph);
		const result = solveNestedRegionLayout(
			prepared.graph,
			prepared.measurements,
			differentlyDirected,
		);
		expect(result.status).toBe(RegionCompositionStatus.Selected);
		if (result.status === RegionCompositionStatus.Selected) {
			const normalized = normalizeRegionCompositionModel(prepared.graph, differentlyDirected);
			expect(normalized.status).toBe(RegionCompositionModelStatus.Ready);
			if (normalized.status === RegionCompositionModelStatus.Ready) {
				expect(validateRegionCompositionGeometry(normalized.model, result)).toBeUndefined();
				expect(validateNestedRegionLeafIncidents(normalized.model, result)).toBeUndefined();
			}
		}
		expect(prepared.graph).toEqual(before);
	});
});
