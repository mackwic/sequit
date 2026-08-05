import type { GroupMeasurement, LayoutMeasurements, Size } from '../layout/layout-graph';

const GROUP_MINIMUM_WIDTH = 160;
const GROUP_MINIMUM_HEIGHT = 72;
const GROUP_HORIZONTAL_PADDING = 24;
const GROUP_HEADER_VERTICAL_PADDING = 24;

function measuredSizes(
	elements: Iterable<HTMLElement>,
	dataKey: keyof DOMStringMap,
): Map<string, Size> {
	const result = new Map<string, Size>();
	for (const element of elements) {
		const id = element.dataset[dataKey];
		if (id === undefined || id.length === 0) continue;
		const { width, height } = element.getBoundingClientRect();
		result.set(id, { width, height });
	}
	return result;
}

export function collectLayoutMeasurements(layer: HTMLDivElement): LayoutMeasurements {
	const nodes = measuredSizes(
		layer.querySelectorAll<HTMLElement>('[data-measure-node]'),
		'measureNode',
	);
	const junctions = measuredSizes(
		layer.querySelectorAll<HTMLElement>('[data-measure-junction]'),
		'measureJunction',
	);
	const groups = new Map<string, GroupMeasurement>();
	for (const element of layer.querySelectorAll<HTMLElement>('[data-measure-group]')) {
		const id = element.dataset['measureGroup'];
		if (id === undefined || id.length === 0) continue;
		const { width, height } = element.getBoundingClientRect();
		groups.set(id, {
			minimumWidth: Math.max(GROUP_MINIMUM_WIDTH, width + GROUP_HORIZONTAL_PADDING * 2),
			minimumHeight: GROUP_MINIMUM_HEIGHT,
			headerHeight: height + GROUP_HEADER_VERTICAL_PADDING,
			padding: GROUP_HORIZONTAL_PADDING,
		});
	}
	return { nodes, junctions, groups };
}

export function layoutMeasurementSignature(measurements: LayoutMeasurements): string {
	return JSON.stringify([
		[...measurements.nodes],
		[...measurements.junctions],
		[...measurements.groups],
	]);
}
