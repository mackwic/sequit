import type { LayoutFrame, MutableBounds } from '../geometry/layout-frame';
import type { LayoutStructure } from '../structure/prepare-layout';
import { encloseGroups } from './enclose-groups';
import { insetJunctionChannels } from './group-junction-channels';
import { junctionRails, railSpan } from './junction-rails';
import { applyOuterMargin, packComponents, repackContainment } from './pack-components';
import { type ComponentLayout, placeComponent } from './place-component';
import type { PreparedMeasurements } from './prepare-measurements';

export interface PlacementState {
	readonly bounds: Map<string, MutableBounds>;
	readonly components: ComponentLayout[];
	groupChannelInsets: ReadonlyMap<number, readonly number[]>;
	transverseCenters?: ReadonlyMap<string, number> | undefined;
	branchOffsets?: ReadonlyMap<string, number> | undefined;
}

export interface PlacementInput {
	readonly structure: LayoutStructure;
	readonly measurements: PreparedMeasurements;
	readonly frame: LayoutFrame;
	readonly placement: PlacementState;
}

/** The larger of two gaps for every rank interval either one sets. */
export function mergeGapMaps(
	left: ReadonlyMap<number, number>,
	right: ReadonlyMap<number, number>,
): ReadonlyMap<number, number> {
	if (right.size === 0) return left;
	const result = new Map(left);
	for (const [rank, gap] of right) result.set(rank, Math.max(result.get(rank) ?? 0, gap));
	return result;
}

/** Replace this call's placement, retaining its structure and reusable component list. */
export function placeElements(
	input: PlacementInput,
	reservedGaps: ReadonlyMap<number, number>,
	channelGaps?: ReadonlyMap<number, readonly number[]>,
): Map<string, MutableBounds> {
	const { structure, measurements, frame, placement } = input;
	const rankGaps = mergeGapMaps(reservedGaps, measurements.frameRankGaps);
	let modifiedGaps: Map<number, number> | undefined;
	let modifiedChannels: Map<number, readonly number[]> | undefined;
	const junctionRows = new Map<number, string[]>();
	for (const [id, junction] of structure.junctions) {
		const row = junctionRows.get(junction.interval) ?? [];
		row.push(id);
		junctionRows.set(junction.interval, row);
	}
	for (const [rank, row] of junctionRows) {
		modifiedGaps ??= new Map(rankGaps);
		const rails = junctionRails({
			row,
			sizes: measurements.sizes,
			vertical: frame.vertical,
			junctions: structure.junctions,
		});
		const insets = placement.groupChannelInsets.get(rank);
		const minimums = measurements.junctionShellGaps.get(rank);
		if (insets !== undefined || minimums !== undefined) {
			modifiedChannels ??= new Map(channelGaps);
			modifiedChannels.set(
				rank,
				insetJunctionChannels(
					rails,
					Math.max(measurements.rankGap, modifiedGaps.get(rank) ?? 0),
					modifiedChannels.get(rank),
					{ insets, minimums },
				),
			);
		}
		modifiedGaps.set(
			rank,
			Math.max(
				modifiedGaps.get(rank) ?? 0,
				railSpan(rails, modifiedChannels?.get(rank) ?? channelGaps?.get(rank)),
			),
		);
	}
	const gaps = modifiedGaps ?? rankGaps;
	const channels = modifiedChannels ?? channelGaps;
	const { graph } = structure;
	const families = {
		graph,
		ranks: structure.ranks.byEndpointId,
		hierarchy: structure.hierarchy,
		groups: measurements.groups,
		junctionIds: structure.junctionIds,
		junctions: structure.junctions,
	};
	for (const [index, component] of structure.components.entries()) {
		placement.components[index] = placeComponent({
			rows: component.rows,
			sizes: measurements.sizes,
			frame,
			primaryBandSizes: measurements.primaryBandSizes,
			rankGap: measurements.rankGap,
			rankGaps: gaps,
			families,
			junctions: structure.junctions,
			channelGaps: channels,
			transverseCenters: placement.transverseCenters,
			branchAlignment: { anchors: structure.branchAnchors, offsets: placement.branchOffsets },
		});
	}
	placement.bounds.clear();
	const cursor = packComponents(placement.components, placement.bounds, frame);
	if (structure.hierarchy !== undefined)
		encloseGroups(
			{
				hierarchy: structure.hierarchy,
				ranks: structure.ranks.byEndpointId,
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
