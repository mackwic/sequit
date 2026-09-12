import type { LayoutFrame, MutableBounds } from '../geometry/layout-frame';
import type { LayoutStructure } from '../structure/prepare-layout';
import { encloseGroups } from './enclose-groups';
import { junctionRails, railSpan } from './junction-rails';
import { applyOuterMargin, packComponents, repackContainment } from './pack-components';
import { type ComponentLayout, placeComponent } from './place-component';
import type { PreparedMeasurements } from './prepare-measurements';

export interface PlacementState {
	readonly bounds: Map<string, MutableBounds>;
	readonly components: ComponentLayout[];
}

export interface PlacementInput {
	readonly structure: LayoutStructure;
	readonly measurements: PreparedMeasurements;
	readonly frame: LayoutFrame;
	readonly placement: PlacementState;
}

/** Replace this call's placement, retaining its structure and reusable component list. */
export function placeElements(
	input: PlacementInput,
	rankGaps: ReadonlyMap<number, number>,
	channelGaps?: ReadonlyMap<number, readonly number[]>,
): Map<string, MutableBounds> {
	const { structure, measurements, frame, placement } = input;
	const gaps = new Map(rankGaps);
	const junctionRows = new Map<number, string[]>();
	for (const [id, junction] of structure.junctions) {
		const row = junctionRows.get(junction.interval) ?? [];
		row.push(id);
		junctionRows.set(junction.interval, row);
	}
	for (const [rank, row] of junctionRows) {
		const rails = junctionRails({
			row,
			sizes: measurements.sizes,
			vertical: frame.vertical,
			junctions: structure.junctions,
		});
		gaps.set(rank, Math.max(gaps.get(rank) ?? 0, railSpan(rails, channelGaps?.get(rank))));
	}
	for (const [index, component] of structure.components.entries()) {
		placement.components[index] = placeComponent({
			rows: component.rows,
			sizes: measurements.sizes,
			frame,
			primaryBandSizes: measurements.primaryBandSizes,
			rankGap: measurements.rankGap,
			rankGaps: gaps,
			parents: structure.graph.outgoingByEndpointId,
			junctions: structure.junctions,
			channelGaps,
		});
	}
	placement.bounds.clear();
	const cursor = packComponents(placement.components, placement.bounds, frame);
	if (structure.hierarchy !== undefined)
		encloseGroups(
			{
				hierarchy: structure.hierarchy,
				measurements: measurements.groups,
				bounds: placement.bounds,
				frame,
			},
			cursor,
		);
	if (structure.containment !== undefined)
		repackContainment(structure.containment, placement.bounds, frame.vertical);
	applyOuterMargin(placement.bounds);
	return placement.bounds;
}
