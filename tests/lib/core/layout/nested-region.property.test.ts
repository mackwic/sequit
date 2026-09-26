import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
	defined,
	LAYOUT_DIRECTIONS,
	layoutConfiguration,
} from '../../../../src/lib/core/document/logic-document';
import { validateNestedRegionGeometry } from '../../../../src/lib/core/layout/nested-region-geometry';
import { solveNestedRegionLayout } from '../../../../src/lib/core/layout/nested-region-layout';
import { RegionCompositionStatus } from '../../../../src/lib/core/layout/regions/model/region-composition-types';
import { layoutWithRootRegion } from '../../../../src/lib/core/layout/root-region';
import { PROPERTY_PARAMETERS } from '../../../support/builders/property-test-options';
import { prepareLayoutDocument } from '../../../support/harnesses/layout';
import { defaultBiasFor } from '../../../support/harnesses/visual-directions';
import {
	depthTwoRegionDocument,
	depthTwoRegionInput,
	nestedRegionInput,
	persistedDepthTwoRegionDocument,
	persistedRegionDocument,
	regionDocument,
} from './nested-region-fixture';

const fractionalSize = fc.record({
	width: fc.integer({ min: 80, max: 280 }).map((value) => value + 0.25),
	height: fc.integer({ min: 40, max: 140 }).map((value) => value + 0.5),
});

describe('nested region real-pipeline properties', () => {
	it('keeps two-level LCAs and geometry stable under measurements, directions and permutations', () => {
		fc.assert(
			fc.property(
				fc.record({
					direction: fc.constantFrom(...LAYOUT_DIRECTIONS),
					aSource: fractionalSize,
					aTarget: fractionalSize,
					b: fractionalSize,
					c: fractionalSize,
					d: fractionalSize,
					e: fractionalSize,
				}),
				(sizes) => {
					const document = persistedDepthTwoRegionDocument({
						...depthTwoRegionDocument(),
						layout: defined(layoutConfiguration(sizes.direction, defaultBiasFor(sizes.direction))),
					});
					const overrides = {
						nodes: {
							'a-source': sizes.aSource,
							'a-target': sizes.aTarget,
							b: sizes.b,
							c: sizes.c,
							d: sizes.d,
							e: sizes.e,
						},
					};
					const original = prepareLayoutDocument(document, overrides);
					const input = depthTwoRegionInput();
					const selected = solveNestedRegionLayout(original.graph, original.measurements, input);
					if (selected.status !== RegionCompositionStatus.Selected)
						throw new Error(`Expected two-level selection: ${selected.status}: ${selected.reason}`);
					expect(validateNestedRegionGeometry(original.graph, input, selected)).toBeUndefined();
					const presentation = defined(document.regionPresentation);
					const permuted = prepareLayoutDocument(
						{
							...document,
							regionPresentation: {
								...presentation,
								regions: [...presentation.regions].reverse(),
							},
							nodes: [...document.nodes].reverse(),
							relations: [...document.relations].reverse(),
						},
						overrides,
					);
					const reversedMeasurements = {
						...permuted.measurements,
						nodes: new Map([...permuted.measurements.nodes].reverse()),
					};
					const reversedInput = {
						regions: [...input.regions].reverse(),
						regionByEndpointId: new Map([...input.regionByEndpointId].reverse()),
					};
					expect(
						solveNestedRegionLayout(permuted.graph, reversedMeasurements, reversedInput),
					).toEqual(selected);
					expect(
						layoutWithRootRegion(permuted.graph, permuted.ranks, reversedMeasurements),
					).toEqual(layoutWithRootRegion(original.graph, original.ranks, original.measurements));
				},
			),
			PROPERTY_PARAMETERS,
		);
	});

	it('selects validated crossings in four directions under fractional measurements and permutations', () => {
		fc.assert(
			fc.property(
				fc.record({
					direction: fc.constantFrom(...LAYOUT_DIRECTIONS),
					aSource: fractionalSize,
					aTarget: fractionalSize,
					b: fractionalSize,
					c: fractionalSize,
				}),
				(sizes) => {
					const document = persistedRegionDocument({
						...regionDocument(),
						layout: defined(layoutConfiguration(sizes.direction, defaultBiasFor(sizes.direction))),
					});
					const overrides = {
						nodes: {
							'a-source': sizes.aSource,
							'a-target': sizes.aTarget,
							b: sizes.b,
							c: sizes.c,
						},
					};
					const cold = prepareLayoutDocument(document, overrides);
					const regionInput = nestedRegionInput();
					const solved = solveNestedRegionLayout(cold.graph, cold.measurements, regionInput);
					if (solved.status !== RegionCompositionStatus.Selected)
						throw new Error(`Expected a selected crossing: ${solved.status}: ${solved.reason}`);
					expect(validateNestedRegionGeometry(cold.graph, regionInput, solved)).toBeUndefined();
					const presentation = defined(document.regionPresentation);
					const permuted = prepareLayoutDocument(
						{
							...document,
							regionPresentation: {
								...presentation,
								regions: [...presentation.regions].reverse(),
							},
							nodes: [...document.nodes].reverse(),
							relations: [...document.relations].reverse(),
						},
						overrides,
					);
					const reversedMeasurements = {
						...permuted.measurements,
						nodes: new Map([...permuted.measurements.nodes].reverse()),
					};
					const reversedInput = {
						regions: [...regionInput.regions].reverse(),
						regionByEndpointId: new Map([...regionInput.regionByEndpointId].reverse()),
					};
					expect(
						solveNestedRegionLayout(permuted.graph, reversedMeasurements, reversedInput),
					).toEqual(solved);
					const baseline = layoutWithRootRegion(cold.graph, cold.ranks, cold.measurements);
					expect(
						layoutWithRootRegion(permuted.graph, permuted.ranks, reversedMeasurements),
					).toEqual(baseline);
				},
			),
			PROPERTY_PARAMETERS,
		);
	});
});
