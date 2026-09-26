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
import {
	applyRankOrder,
	collectRankOrderDomain,
} from '../../../../src/lib/core/layout/rank/rank-ordering';
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

	it('keeps alternating candidate evaluations independent with groups and routing', () => {
		fc.assert(
			fc.property(fc.constantFrom(...LAYOUT_CONFIGURATIONS), (layout) => {
				const document = enclosedCrossings(layout, false);
				const prepared = prepareLayoutDocument(document);
				const structure = prepareLayout(prepared.graph, prepared.ranks);
				const domain = collectRankOrderDomain(structure);
				const orderA = domain.bands.map((band) => [...band]);
				const orderB = domain.bands.map((band) => [...band].reverse());
				expect(orderB).not.toEqual(orderA);
				const preparedSnapshot = structuredClone(prepared);
				const documentSnapshot = structuredClone(document);

				const structureB = applyRankOrder(structure, domain, orderB);
				const structureAAfterB = applyRankOrder(structureB, domain, orderA);
				const structureBAfterA = applyRankOrder(structureAAfterB, domain, orderB);
				const publicA = layoutWithDedicatedEngine(
					prepared.graph,
					prepared.ranks,
					prepared.measurements,
				);
				const publicAInspected = layoutWithDedicatedEngine(
					prepared.graph,
					prepared.ranks,
					prepared.measurements,
					{ inspectRouting: true },
				);
				const explicitA = evaluateDedicatedLayout(
					applyRankOrder(structure, domain, orderA),
					prepared.measurements,
				);
				const trialA1 = evaluateDedicatedLayout(
					structureAAfterB,
					prepared.measurements,
					{ inspectRouting: true },
					true,
				);
				const trialB1 = evaluateDedicatedLayout(
					structureB,
					prepared.measurements,
					{ inspectRouting: true },
					true,
				);
				const trialA2 = evaluateDedicatedLayout(
					applyRankOrder(structure, domain, orderA),
					prepared.measurements,
					{ inspectRouting: true },
					true,
				);
				const trialB2 = evaluateDedicatedLayout(
					structureBAfterA,
					prepared.measurements,
					{ inspectRouting: true },
					true,
				);

				expect(explicitA).toEqual(publicA);
				expect(trialA1.result).toEqual(publicA);
				expect(trialA1.complete()).toEqual(publicAInspected);
				expect(trialB1.result).not.toEqual(trialA1.result);
				expect(trialA1.result).toEqual(trialA2.result);
				expect(trialA1.complete()).toEqual(trialA2.complete());
				expect(trialB1.result).toEqual(trialB2.result);
				expect(trialB1.complete()).toEqual(trialB2.complete());
				expect(prepared).toEqual(preparedSnapshot);
				expect(document).toEqual(documentSnapshot);
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
