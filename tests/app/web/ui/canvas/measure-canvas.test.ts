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
});
