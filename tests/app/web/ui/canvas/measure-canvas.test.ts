import { describe, expect, it } from 'vitest';

import {
	collectLayoutMeasurements,
	layoutMeasurementSignature,
} from '../../../../../src/app/web/ui/canvas/measure-canvas';

function measurable(data: Record<string, string>, width: number, height: number): HTMLElement {
	// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Minimal DOM boundary stub.
	return {
		dataset: data,
		getBoundingClientRect: () => ({ width, height }),
	} as unknown as HTMLElement;
}
function measurementRoot(elements: Record<string, readonly HTMLElement[]>): HTMLDivElement {
	// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Minimal DOM boundary stub.
	return {
		querySelectorAll: (selector: string) => elements[selector] ?? [],
	} as unknown as HTMLDivElement;
}

describe('canvas measurement boundary', () => {
	it('collects node, junction, and group dimensions from the measurement render', () => {
		const root = measurementRoot({
			'[data-measure-node]': [measurable({ measureNode: 'node-a' }, 220, 104.5)],
			'[data-measure-junction]': [measurable({ measureJunction: 'junction-a' }, 32, 32)],
			'[data-measure-group]': [measurable({ measureGroup: 'group-a' }, 88, 14)],
		});

		expect(collectLayoutMeasurements(root)).toEqual({
			nodes: new Map([['node-a', { width: 220, height: 104.5 }]]),
			junctions: new Map([['junction-a', { width: 32, height: 32 }]]),
			groups: new Map([
				['group-a', { minimumWidth: 160, minimumHeight: 72, headerHeight: 38, padding: 24 }],
			]),
		});
	});

	it('ignores measurement elements without stable identifiers', () => {
		const root = measurementRoot({
			'[data-measure-node]': [measurable({}, 220, 100)],
			'[data-measure-junction]': [measurable({}, 32, 32)],
			'[data-measure-group]': [measurable({}, 88, 14)],
		});

		const measurements = collectLayoutMeasurements(root);
		expect(measurements.nodes.size).toBe(0);
		expect(measurements.junctions.size).toBe(0);
		expect(measurements.groups.size).toBe(0);
	});

	it('ignores empty identifiers and lets a wide group header grow its measured width', () => {
		const root = measurementRoot({
			'[data-measure-node]': [measurable({ measureNode: '' }, 220, 100)],
			'[data-measure-junction]': [measurable({ measureJunction: '' }, 32, 32)],
			'[data-measure-group]': [
				measurable({ measureGroup: '' }, 88, 14),
				measurable({ measureGroup: 'wide-group' }, 200, 20),
			],
		});

		expect(collectLayoutMeasurements(root)).toEqual({
			nodes: new Map(),
			junctions: new Map(),
			groups: new Map([
				['wide-group', { minimumWidth: 248, minimumHeight: 72, headerHeight: 44, padding: 24 }],
			]),
		});
	});

	it('changes its signature only when a measured collection changes', () => {
		const original = collectLayoutMeasurements(
			measurementRoot({
				'[data-measure-node]': [measurable({ measureNode: 'node-a' }, 220, 100)],
				'[data-measure-junction]': [],
				'[data-measure-group]': [],
			}),
		);
		const identical = {
			...original,
			nodes: new Map(original.nodes),
		};
		const changed = {
			...original,
			nodes: new Map([['node-a', { width: 220, height: 101 }]]),
		};

		expect(layoutMeasurementSignature(identical)).toBe(layoutMeasurementSignature(original));
		expect(layoutMeasurementSignature(changed)).not.toBe(layoutMeasurementSignature(original));
	});

	it('normalizes insertion order independently for nodes, junctions, and groups', () => {
		const first = {
			nodes: new Map([
				['b', { width: 200, height: 100 }],
				['a', { width: 220, height: 120 }],
			]),
			junctions: new Map([
				['j2', { width: 24, height: 24 }],
				['j1', { width: 28, height: 28 }],
			]),
			groups: new Map([
				['g2', { minimumWidth: 160, minimumHeight: 72, headerHeight: 36, padding: 24 }],
				['g1', { minimumWidth: 180, minimumHeight: 72, headerHeight: 40, padding: 24 }],
			]),
		};
		const reversed = {
			nodes: new Map([...first.nodes].reverse()),
			junctions: new Map([...first.junctions].reverse()),
			groups: new Map([...first.groups].reverse()),
		};
		expect(layoutMeasurementSignature(reversed)).toBe(layoutMeasurementSignature(first));
	});
});
