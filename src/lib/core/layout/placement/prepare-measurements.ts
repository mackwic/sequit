import { defined, EndpointKind } from '../../document/logic-document';
import type { LayoutFrame } from '../geometry/layout-frame';
import { mainSize, transverseSize } from '../geometry/layout-frame';
import { BASE_RANK_GAP, PORT_INSET } from '../layout-settings';
import type { GroupMeasurement, LayoutMeasurements, Size } from '../layout-types';
import type { LayoutStructure } from '../structure/prepare-layout';
import { frameShellGaps } from './frame-shell-gaps';
import { validateGroupMeasurement, validateSize } from './validate-measurements';

export interface PreparedMeasurements {
	readonly content: LayoutMeasurements;
	readonly sizes: Map<string, Size>;
	readonly groups: ReadonlyMap<string, GroupMeasurement>;
	readonly primaryBandSizes: readonly number[];
	readonly rankGap: number;
	/** Minimum junction channel gaps by interval and slot, holding frames ending on a rail. */
	readonly junctionShellGaps: ReadonlyMap<number, readonly number[]>;
}

interface GroupReader {
	readonly groups: Map<string, GroupMeasurement>;
	readonly get: (id: string) => GroupMeasurement;
}

function groupReader(measurements: LayoutMeasurements): GroupReader {
	const groups = new Map<string, GroupMeasurement>();
	return {
		groups,
		get(id) {
			const known = groups.get(id);
			if (known !== undefined) return known;
			const measurement = measurements.groups.get(id);
			if (measurement === undefined) throw new Error(`Missing group measurement: ${id}`);
			const validated = validateGroupMeasurement(measurement, id);
			groups.set(id, validated);
			return validated;
		},
	};
}

function endpointSize(
	structure: LayoutStructure,
	measurements: LayoutMeasurements,
	groups: GroupReader,
	id: string,
): Size {
	const endpoint = defined(structure.graph.endpointsById.get(id));
	if (endpoint.kind === EndpointKind.Node) {
		const size = measurements.nodes.get(id);
		if (size === undefined) throw new Error(`Missing node measurement: ${id}`);
		return validateSize(size, `nodes.${id}`);
	}
	if (endpoint.kind === EndpointKind.Junction) {
		const size = measurements.junctions.get(id);
		if (size === undefined) throw new Error(`Missing junction measurement: ${id}`);
		return validateSize(size, `junctions.${id}`);
	}
	const measurement = groups.get(id);
	return { width: measurement.minimumWidth, height: measurement.minimumHeight };
}

/** The shell values keep physical headers at the top, independent of rank progression. */
function shellReader(
	structure: LayoutStructure,
	groups: GroupReader,
	includeHeader: boolean,
): (id: string) => number {
	const cached = new Map<string, number>();
	return (id: string): number => {
		const path: string[] = [];
		let current: string | undefined = id;
		while (current !== undefined && !cached.has(current)) {
			groups.get(current);
			path.push(current);
			current = structure.hierarchy?.byId.get(current)?.groupId;
		}
		let extent = 0;
		if (current !== undefined) extent = defined(cached.get(current));
		while (path.length > 0) {
			const next = defined(path.pop());
			const measurement = groups.get(next);
			let header = 0;
			if (includeHeader) header = measurement.headerHeight;
			extent = measurement.padding + header + extent;
			cached.set(next, extent);
		}
		return extent;
	};
}

function relationGroupRankGap(
	structure: LayoutStructure,
	frame: LayoutFrame,
	groups: GroupReader,
): number {
	if (structure.hierarchy === undefined) return BASE_RANK_GAP;
	const leading = shellReader(structure, groups, frame.vertical);
	const trailing = shellReader(structure, groups, false);
	const shell = (endpointId: string, forwardLeading: boolean): number => {
		const groupId = structure.graph.endpointsById.get(endpointId)?.entity.groupId;
		if (groupId === undefined) return 0;
		if (forwardLeading) return leading(groupId);
		return trailing(groupId);
	};
	let gap = BASE_RANK_GAP;
	for (const relation of structure.graph.effectiveRelations) {
		const source = Math.max(0, ...relation.sourceIds.map((id) => shell(id, frame.forward)));
		const target = Math.max(0, ...relation.targetIds.map((id) => shell(id, !frame.forward)));
		gap = Math.max(gap, source + target);
	}
	return gap;
}

function needsNodePortInset(
	structure: LayoutStructure,
	frame: LayoutFrame,
	id: string,
	size: Size,
): boolean {
	if (transverseSize(size, frame.vertical) >= 2 * PORT_INSET) return false;
	if (defined(structure.graph.endpointsById.get(id)).kind !== EndpointKind.Node) return false;
	return (
		defined(structure.graph.outgoingByEndpointId.get(id)).length > 0 ||
		defined(structure.graph.predecessorsByEndpointId.get(id)).length > 0
	);
}

export function prepareMeasurements(
	structure: LayoutStructure,
	content: LayoutMeasurements,
	frame: LayoutFrame,
): PreparedMeasurements {
	const sizes = new Map<string, Size>();
	const groups = groupReader(content);
	for (const id of structure.graph.rankableEndpointIds) {
		const size = endpointSize(structure, content, groups, id);
		if (!needsNodePortInset(structure, frame, id, size)) sizes.set(id, size);
		else if (frame.vertical) sizes.set(id, { ...size, width: 2 * PORT_INSET });
		else sizes.set(id, { ...size, height: 2 * PORT_INSET });
	}
	const primaryBandSizes = Array.from({ length: structure.maximumRank + 1 }, () => 1);
	for (const [id, size] of sizes) {
		if (structure.junctionIds.has(id)) continue;
		// A populated group endpoint is drawn as its members' frame, not as a box in one band.
		if (structure.hierarchy?.membersById.has(id) === true) continue;
		const rank = defined(structure.ranks.byEndpointId.get(id));
		primaryBandSizes[rank] = Math.max(
			defined(primaryBandSizes[rank]),
			mainSize(size, frame.vertical),
		);
	}
	const relationGap = relationGroupRankGap(structure, frame, groups);
	const shells = frameShellGaps({
		structure,
		frame,
		groups: groups.get,
		sizes,
		bandSizes: primaryBandSizes,
		minimumGap: relationGap,
	});
	for (const group of structure.hierarchy?.deepestFirst ?? []) groups.get(group.id);
	return {
		content,
		sizes,
		groups: groups.groups,
		primaryBandSizes,
		rankGap: Math.max(relationGap, shells.rankGap),
		junctionShellGaps: shells.junctionGaps,
	};
}
