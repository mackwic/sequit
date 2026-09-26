import { makeSharedLaneFrame } from './shared-lane-frame';
import type { SharedLaneGeometry } from './shared-lane-geometry';
import { interiorPassageAllocation } from './shared-lane-interior-passage';
import type { SharedLaneInput } from './shared-lane-model';
import type { SharedLanePorts } from './shared-lane-ports';
import { allocateParallelRoutes, routeSharedLanes } from './shared-lane-routing';
import { makeTransverseLaneFrame } from './shared-transverse-frame';
import {
	allocateTransverseRoutes,
	routeTransverseLanes,
	type TransverseRouteOrder,
} from './shared-transverse-routing';

function geometryDimensions(
	input: SharedLaneInput,
	crossExtent: number,
	longExtent: number,
): { readonly width: number; readonly height: number } {
	if (input.vertical) return { width: crossExtent, height: longExtent };
	return { width: longExtent, height: crossExtent };
}

export function interiorParallelGeometry(
	input: SharedLaneInput,
	ports: SharedLanePorts,
): SharedLaneGeometry | undefined {
	const frame = makeSharedLaneFrame(input, ports);
	const passage = interiorPassageAllocation(input, frame, ports);
	if (passage === undefined) return undefined;
	const dimensions = geometryDimensions(input, frame.crossExtent, frame.longExtent);
	return {
		...dimensions,
		lanes: frame.lanes,
		elements: frame.elements,
		relations: routeSharedLanes(input, frame, {
			...allocateParallelRoutes(input, frame),
			passage,
		}),
	};
}

export function transverseGeometry(
	input: SharedLaneInput,
	ports: SharedLanePorts,
	order: TransverseRouteOrder,
): SharedLaneGeometry {
	const frame = makeTransverseLaneFrame(input, ports);
	const dimensions = geometryDimensions(input, frame.crossExtent, frame.longExtent);
	return {
		...dimensions,
		lanes: frame.lanes,
		elements: frame.elements,
		relations: routeTransverseLanes(
			input,
			frame,
			allocateTransverseRoutes(input, frame, order),
			order,
		),
	};
}
