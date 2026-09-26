import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
	defined,
	EndpointKind,
	type LayoutConfiguration,
	type LogicDocument,
	type LogicGroup,
} from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import {
	evaluateDedicatedLayout,
	layoutWithDedicatedEngine,
} from '../../../../src/lib/core/layout/layout-engine';
import { prepareLayout } from '../../../../src/lib/core/layout/structure/prepare-layout';
import { LAYOUT_CONFIGURATIONS } from '../../../support/builders/layout-bias-scenario';
import { validLogicDocument } from '../../../support/builders/logic-document';
import { PROPERTY_PARAMETERS } from '../../../support/builders/property-test-options';
import { graphFixtures } from '../../../support/fixtures/graph-fixtures';
import {
	type PreparedLayoutDocument,
	prepareLayoutDocument,
} from '../../../support/harnesses/layout';

const size = fc.record({
	width: fc.integer({ min: 1, max: 600 }).map((value) => value / 10),
	height: fc.integer({ min: 1, max: 300 }).map((value) => value / 10),
});

function assertIndependentCalculations(prepared: PreparedLayoutDocument): void {
	const original = structuredClone(prepared);
	const first = layoutWithDedicatedEngine(prepared.graph, prepared.ranks, prepared.measurements);
	const saved = structuredClone(first);
	const changed = {
		...prepared.measurements,
		nodes: new Map(
			[...prepared.measurements.nodes].map(([id, value]) => [
				id,
				{ width: value.width + 73, height: value.height + 29 },
			]),
		),
	};
	layoutWithDedicatedEngine(prepared.graph, prepared.ranks, changed, {
		inspectRouting: true,
	});
	expect(first).toEqual(saved);
	expect(prepared).toEqual(original);
	expect(layoutWithDedicatedEngine(prepared.graph, prepared.ranks, prepared.measurements)).toEqual(
		saved,
	);
}

function enclosedCrossings(layout: LayoutConfiguration, nested: boolean): LogicDocument {
	const fixture = graphFixtures
		.crossingRoutes(layout.direction)
		.nodes(['e', 'f', 'g', 'h'])
		.arrowsFrom('e', ['g', 'h'])
		.arrowsFrom('f', ['g', 'h'])
		.build();
	const groups: LogicGroup[] = ['first', 'second'].map((id, index) => {
		const group: LogicGroup = {
			kind: EndpointKind.Group,
			id,
			label: id,
			layoutOrder: orderKey(`a${index}`),
		};
		if (nested) return { ...group, groupId: 'outer' };
		return group;
	});
	if (nested)
		groups.push({
			kind: EndpointKind.Group,
			id: 'outer',
			label: 'Outer',
			layoutOrder: orderKey('a2'),
		});
	return {
		...validLogicDocument(),
		layout,
		groups,
		junctions: [],
		relations: fixture.relations,
		nodes: Object.keys(fixture.nodes).map((id, index) => ({
			kind: EndpointKind.Node,
			id,
			natureId: 'goal',
			markdown: id,
			layoutOrder: orderKey(`b0${index}`),
			groupId: defined(groups[Math.floor(index / 4)]).id,
		})),
	};
}

describe('layout workspace ownership', () => {
	it('keeps prior results and borrowed inputs intact across calls with different measurements', () => {
		fc.assert(
			fc.property(fc.constantFrom(...LAYOUT_CONFIGURATIONS), size, (layout, dimensions) => {
				const document = { ...validLogicDocument(), layout };
				const prepared = prepareLayoutDocument(document, {
					nodes: Object.fromEntries(document.nodes.map((node) => [node.id, dimensions])),
				});
				assertIndependentCalculations(prepared);
			}),
			PROPERTY_PARAMETERS,
		);
	});

	it('keeps candidate evaluations isolated from the baseline, graph and measurements', () => {
		fc.assert(
			fc.property(fc.constantFrom(...LAYOUT_CONFIGURATIONS), (layout) => {
				const prepared = prepareLayoutDocument({ ...validLogicDocument(), layout });
				const structure = prepareLayout(prepared.graph, prepared.ranks);
				const order = structure.rankOrderDomain.bands.map((band) => [...band].reverse());
				const inputSnapshot = structuredClone(prepared);
				const first = layoutWithDedicatedEngine(
					prepared.graph,
					prepared.ranks,
					prepared.measurements,
				);
				const saved = structuredClone(first);

				evaluateDedicatedLayout(
					prepareLayout(prepared.graph, prepared.ranks, order),
					prepared.measurements,
				);
				const inspected = evaluateDedicatedLayout(structure, prepared.measurements, {
					inspectRouting: true,
				}).complete();

				const { routingInspection, ...inspectedGeometry } = inspected;
				expect(inspectedGeometry).toEqual(first);
				expect(routingInspection).toBeDefined();
				expect(first).toEqual(saved);
				expect(prepared).toEqual(inputSnapshot);
				expect(
					layoutWithDedicatedEngine(prepared.graph, prepared.ranks, prepared.measurements),
				).toEqual(saved);
			}),
			PROPERTY_PARAMETERS,
		);
	});

	it('keeps enlarged ports, rails and nested enclosures local to the current calculation', () => {
		fc.assert(
			fc.property(
				fc.constantFrom(...LAYOUT_CONFIGURATIONS),
				fc.boolean(),
				fc.array(size, { minLength: 8, maxLength: 8 }),
				(layout, nested, dimensions) => {
					const document = enclosedCrossings(layout, nested);
					const prepared = prepareLayoutDocument(document, {
						nodes: Object.fromEntries(
							document.nodes.map((node, index) => [node.id, defined(dimensions[index])]),
						),
					});
					assertIndependentCalculations(prepared);
					const plain = layoutWithDedicatedEngine(
						prepared.graph,
						prepared.ranks,
						prepared.measurements,
					);
					const { routingInspection, ...geometry } = layoutWithDedicatedEngine(
						prepared.graph,
						prepared.ranks,
						prepared.measurements,
						{ inspectRouting: true },
					);
					expect(geometry).toEqual(plain);
					expect(routingInspection?.corridors.some((corridor) => corridor.allocated)).toBe(true);
				},
			),
			PROPERTY_PARAMETERS,
		);
	});

	it('adds inspection without changing geometry or retaining mutable state for the next call', () => {
		const prepared = prepareLayoutDocument(validLogicDocument());
		const plain = layoutWithDedicatedEngine(prepared.graph, prepared.ranks, prepared.measurements);
		const inspected = layoutWithDedicatedEngine(
			prepared.graph,
			prepared.ranks,
			prepared.measurements,
			{ inspectRouting: true },
		);
		const { routingInspection, ...geometry } = inspected;
		expect(geometry).toEqual(plain);
		expect(routingInspection).toBeDefined();
		const snapshot = structuredClone(inspected);
		layoutWithDedicatedEngine(prepared.graph, prepared.ranks, prepared.measurements);
		expect(inspected).toEqual(snapshot);
	});
});
