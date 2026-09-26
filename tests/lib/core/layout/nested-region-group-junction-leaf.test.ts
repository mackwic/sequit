import { describe, expect, it } from 'vitest';

import {
	defined,
	EndpointKind,
	JunctionOperator,
	type LogicDocument,
} from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import { solveRecursiveNestedRegionLayout } from '../../../../src/lib/core/layout/nested-region-recursive-layout';
import {
	normalizeRegionCompositionModel,
	RegionCompositionModelStatus,
} from '../../../../src/lib/core/layout/regions/model/region-composition-model';
import {
	RegionCompositionStatus,
	type RegionInput,
} from '../../../../src/lib/core/layout/regions/model/region-composition-types';
import { RegionLocalLayoutCache } from '../../../../src/lib/core/layout/regions/model/region-local-cache';
import { validateNestedRegionLeafIncidentsMessage as validateNestedRegionLeafIncidents } from '../../../../src/lib/core/layout/regions/validation/nested-region-leaf-incident-validation';
import { validateRegionCompositionGeometryMessage as validateRegionCompositionGeometry } from '../../../../src/lib/core/layout/regions/validation/region-composition-validation';
import { prepareLayoutDocument } from '../../../support/harnesses/layout';
import { nestedRegionInput, regionDocument } from './nested-region-fixture';

function withMiddleEndpoint(id: string): RegionInput {
	const base = nestedRegionInput();
	return {
		...base,
		regionByEndpointId: new Map([...base.regionByEndpointId, [id, 'middle']]),
	};
}

describe('groups and junctions in recursive region leaves', () => {
	it('keeps a grouped member inside its local group and reuses the leaf after a foreign edit', () => {
		const source = regionDocument();
		const document: LogicDocument = {
			...source,
			groups: [
				{
					kind: EndpointKind.Group,
					id: 'middle-group',
					label: 'Middle group',
					layoutOrder: orderKey('a2'),
				},
			],
			nodes: source.nodes.map((node) => {
				if (node.id === 'b') return { ...node, groupId: 'middle-group' };
				return node;
			}),
		};
		const input = withMiddleEndpoint('middle-group');
		const prepared = prepareLayoutDocument(document, {
			groups: {
				'middle-group': {
					minimumWidth: 390,
					minimumHeight: 240,
					headerHeight: 36,
					padding: 24,
				},
			},
		});
		const cache = new RegionLocalLayoutCache();
		const selected = solveRecursiveNestedRegionLayout(
			prepared.graph,
			prepared.measurements,
			input,
			cache,
		);
		if (selected.status !== RegionCompositionStatus.Selected) throw new Error(selected.reason);
		const group = defined(selected.layout.elements.find(({ id }) => id === 'middle-group'));
		const member = defined(selected.layout.elements.find(({ id }) => id === 'b'));
		expect(group.bounds.width).toBeGreaterThanOrEqual(390);
		expect(group.bounds.height).toBeGreaterThanOrEqual(240);
		expect(member.bounds.x).toBeGreaterThan(group.bounds.x);
		expect(member.bounds.y).toBeGreaterThan(group.bounds.y);
		expect(member.bounds.x + member.bounds.width).toBeLessThan(group.bounds.x + group.bounds.width);
		expect(member.bounds.y + member.bounds.height).toBeLessThan(
			group.bounds.y + group.bounds.height,
		);
		const normalized = normalizeRegionCompositionModel(prepared.graph, input);
		if (normalized.status !== RegionCompositionModelStatus.Ready)
			throw new Error(normalized.diagnostic.message);
		expect(validateRegionCompositionGeometry(normalized.model, selected)).toBeUndefined();
		expect(validateNestedRegionLeafIncidents(normalized.model, selected)).toBeUndefined();

		const changedNodes = new Map(prepared.measurements.nodes);
		const right = defined(changedNodes.get('c'));
		changedNodes.set('c', { ...right, width: right.width + 27.5 });
		const changed = { ...prepared.measurements, nodes: changedNodes };
		const incremental = solveRecursiveNestedRegionLayout(prepared.graph, changed, input, cache);
		const cold = solveRecursiveNestedRegionLayout(prepared.graph, changed, input);
		expect(incremental).toEqual(cold);
		expect(cache.stats.hits).toBeGreaterThanOrEqual(2);
	});

	it('keeps a local junction and its relation in the owning leaf', () => {
		const source = regionDocument();
		const document: LogicDocument = {
			...source,
			junctions: [
				{
					kind: EndpointKind.Junction,
					id: 'middle-junction',
					operator: JunctionOperator.Xor,
					layoutOrder: orderKey('a4'),
				},
			],
			relations: [...source.relations, { id: 'middle-local', from: 'b', to: 'middle-junction' }],
		};
		const input = withMiddleEndpoint('middle-junction');
		const prepared = prepareLayoutDocument(document);
		const selected = solveRecursiveNestedRegionLayout(prepared.graph, prepared.measurements, input);
		if (selected.status !== RegionCompositionStatus.Selected) throw new Error(selected.reason);
		expect(selected.layout.elements.find(({ id }) => id === 'middle-junction')).toBeDefined();
		expect(selected.layout.relations.find(({ id }) => id === 'middle-local')).toBeDefined();
		const middle = defined(selected.regions.find(({ id }) => id === 'middle'));
		expect(middle.localLayout.elements.map(({ id }) => id).sort()).toEqual([
			'b',
			'middle-junction',
		]);
		expect(middle.localLayout.relations.map(({ id }) => id)).toEqual(['middle-local']);
	});

	it('routes a group-member crossing out of its containing group', () => {
		const source = regionDocument();
		const document: LogicDocument = {
			...source,
			groups: [
				{
					kind: EndpointKind.Group,
					id: 'left-group',
					label: 'Left group',
					layoutOrder: orderKey('a0'),
				},
			],
			nodes: source.nodes.map((node) => {
				if (node.id === 'a-target') return { ...node, groupId: 'left-group' };
				return node;
			}),
		};
		const base = nestedRegionInput();
		const input = {
			...base,
			regionByEndpointId: new Map([...base.regionByEndpointId, ['left-group', 'left']]),
		};
		const prepared = prepareLayoutDocument(document);
		const selected = solveRecursiveNestedRegionLayout(prepared.graph, prepared.measurements, input);
		expect(selected.status).toBe(RegionCompositionStatus.Selected);
		if (selected.status !== RegionCompositionStatus.Selected) return;
		const normalized = normalizeRegionCompositionModel(prepared.graph, input);
		if (normalized.status !== RegionCompositionModelStatus.Ready)
			throw new Error(normalized.diagnostic.message);
		expect(validateRegionCompositionGeometry(normalized.model, selected)).toBeUndefined();
		expect(validateNestedRegionLeafIncidents(normalized.model, selected)).toBeUndefined();
		expect(
			selected.layout.relations.find(({ id }) => id === 'across-middle')?.points.length,
		).toBeGreaterThan(1);
	});
});
