import { describe, expect, it } from 'vitest';

import { defined, type LogicDocument } from '../../../../src/lib/core/document/logic-document';
import { routeBridgeAnalysis } from '../../../../src/lib/core/layout/bridges/bridge-oracle';
import { validateSharedLaneGeometry } from '../../../../src/lib/core/layout/lanes/shared-lane-geometry';
import { prepareSharedLanes } from '../../../../src/lib/core/layout/lanes/shared-lane-model';
import {
	incidenceKey,
	planSharedLanePorts,
	PortRole,
} from '../../../../src/lib/core/layout/lanes/shared-lane-ports';
import { prepareLayoutDocument } from '../../../support/harnesses/layout';
import {
	configurations,
	documentFor,
	geometry,
	normalized,
	orientations,
	rename,
} from './shared-lane-port-fixture';

const regressionWitnesses = [
	{
		name: 'three-node local chain',
		nodes: [
			['x', 'L1'],
			['y', 'L1'],
			['z', 'L1'],
		],
		pairs: [
			['z', 'y'],
			['y', 'x'],
		],
	},
	{
		name: 'local chain with a fan',
		nodes: [
			['x', 'L1'],
			['y', 'L1'],
			['z', 'L1'],
			['w', 'L1'],
		],
		pairs: [
			['z', 'y'],
			['w', 'y'],
			['y', 'x'],
		],
	},
	{
		name: 'cross-lane fan with an equal-row endpoint',
		nodes: [
			['a1', 'A'],
			['a2', 'A'],
			['b1', 'B'],
			['b2', 'B'],
			['c1', 'C'],
			['c2', 'C'],
		],
		pairs: [
			['a1', 'b1'],
			['a1', 'c1'],
			['a1', 'c2'],
		],
	},
	{
		name: 'local arc sharing a face with a cross-lane passage',
		nodes: [
			['a1', 'A'],
			['a2', 'A'],
			['b1', 'B'],
			['c1', 'C'],
		],
		pairs: [
			['a1', 'a2'],
			['a1', 'b1'],
			['a2', 'c1'],
			['b1', 'c1'],
		],
	},
] as const;

describe.each(orientations)('shared lane port nesting (%s)', (orientation) => {
	it.each(configurations)('preserves L-02 geometry when c becomes z in $direction', (layout) => {
		const document = documentFor(
			layout,
			orientation,
			[
				['a', 'L1'],
				['b', 'L1'],
				['c', 'L2'],
				['d', 'L3'],
			],
			[
				['a', 'c'],
				['b', 'c'],
				['a', 'd'],
			],
		);
		expect(normalized(rename(document, new Map([['c', 'z']])))).toEqual(normalized(document));
		expect(routeBridgeAnalysis(geometry(document).relations).crossings).toHaveLength(0);
	});

	it.each(configurations)(
		'keeps M1-01 crossing-free regardless of naming in $direction',
		(layout) => {
			const document = documentFor(
				layout,
				orientation,
				[
					['a1', 'A'],
					['a2', 'A'],
					['b1', 'B'],
					['b2', 'B'],
					['c1', 'C'],
				],
				[
					['c1', 'a1'],
					['b2', 'b1'],
					['a2', 'a1'],
					['b1', 'a1'],
				],
			);
			const renamed = rename(
				document,
				new Map(document.nodes.map(({ id }, index) => [id, `z${document.nodes.length - index}`])),
			);
			expect(normalized(renamed)).toEqual(normalized(document));
			expect(routeBridgeAnalysis(geometry(document).relations).crossings).toHaveLength(0);
		},
	);

	it.each(configurations)('nests the M2-06 fork and fan in $direction', (layout) => {
		for (const count of [2, 3]) {
			const sources = Array.from({ length: count }, (_, index) => `S${index + 1}`);
			for (const outward of [false, true]) {
				const pairs = sources.map((id): readonly [string, string] => {
					if (outward) return ['P', id];
					return [id, 'P'];
				});
				const document = documentFor(
					layout,
					orientation,
					[['P', 'L1'], ...sources.map((id): readonly [string, string] => [id, 'L1'])],
					pairs,
				);
				expect(routeBridgeAnalysis(geometry(document).relations).crossings).toHaveLength(0);
			}
		}
	});

	it.each(configurations)(
		'orders tied opposite rows by documentary position in $direction',
		(layout) => {
			const document = documentFor(
				layout,
				orientation,
				[
					['a', 'L1'],
					['b', 'L2'],
					['c', 'L2'],
				],
				[
					['a', 'b'],
					['a', 'c'],
				],
			);
			const offsets = (variant: LogicDocument) => {
				const prepared = prepareLayoutDocument(variant);
				const input = defined(
					prepareSharedLanes(prepared.graph, prepared.ranks, prepared.measurements, {}).input,
				);
				return planSharedLanePorts({
					...input,
					endpoints: new Map(
						[...input.endpoints].map(([id, endpoint]) => [id, { ...endpoint, row: 0 }]),
					),
				}).offsetByIncidence;
			};
			const original = offsets(document);
			const renamed = offsets(
				rename(
					document,
					new Map([
						['b', 'z'],
						['c', 'y'],
					]),
				),
			);
			expect(renamed).toEqual(original);
			expect(defined(original.get(incidenceKey('r0', PortRole.Source)))).toBeLessThan(
				defined(original.get(incidenceKey('r1', PortRole.Source))),
			);
		},
	);
	for (const witness of regressionWitnesses) {
		it.each(configurations)(`keeps ${witness.name} bridge-free in $direction`, (layout) => {
			const document = documentFor(layout, orientation, witness.nodes, witness.pairs);
			const result = geometry(document);
			const prepared = prepareLayoutDocument(document);
			expect(validateSharedLaneGeometry(prepared.graph, result)).toBeUndefined();
			expect(routeBridgeAnalysis(result.relations).crossings).toHaveLength(0);
			expect(routeBridgeAnalysis(result.relations).bridges).toHaveLength(0);
			const ids = new Map(
				document.nodes.map(({ id }, index) => [id, `renamed-${document.nodes.length - index}`]),
			);
			expect(normalized(rename(document, ids))).toEqual(normalized(document));
		});
	}
});
