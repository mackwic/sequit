import { LayoutDirection } from '../../document/logic-document';
import {
	BASE_RANK_GAP,
	OUTER_MARGIN,
	PORT_INSET,
	PORT_SPACING,
	RAIL_SPACING,
} from '../layout-settings';
import type { Bounds, GroupMeasurement, Point, Size } from '../layout-types';

export enum FoldedSideFace {
	Left = 'left',
	Right = 'right',
	Top = 'top',
	Bottom = 'bottom',
}

export interface FoldedGeometry {
	readonly groupBounds: Bounds;
	readonly externalBounds: Bounds;
	readonly groupFace: FoldedSideFace;
	readonly externalFace: FoldedSideFace;
	readonly groupB: Point;
	readonly groupA: Point;
	readonly externalSource: Point;
	readonly externalTarget: Point;
	readonly leavingRailStart: Point;
	readonly leavingRailEnd: Point;
	readonly returningRailStart: Point;
	readonly returningRailEnd: Point;
	readonly width: number;
	readonly height: number;
}

interface AxisMetrics {
	readonly vertical: boolean;
	readonly reversed: boolean;
	readonly externalLongMeasure: number;
	readonly externalCrossSize: number;
	readonly groupCrossSize: number;
	readonly groupLongMinimum: number;
	readonly edgeInset: number;
	readonly groupFace: FoldedSideFace;
	readonly externalFace: FoldedSideFace;
}

function axisMetrics(
	direction: LayoutDirection,
	group: GroupMeasurement,
	external: Size,
): AxisMetrics {
	const reversed =
		direction === LayoutDirection.BottomToTop || direction === LayoutDirection.RightToLeft;
	const vertical =
		direction === LayoutDirection.TopToBottom || direction === LayoutDirection.BottomToTop;
	const paddedHeight = Math.max(group.minimumHeight, group.headerHeight + 2 * group.padding);
	if (vertical)
		return {
			vertical,
			reversed,
			externalLongMeasure: external.height,
			externalCrossSize: external.width,
			groupCrossSize: group.minimumWidth,
			groupLongMinimum: paddedHeight,
			edgeInset: group.headerHeight + group.padding + PORT_INSET,
			groupFace: FoldedSideFace.Right,
			externalFace: FoldedSideFace.Left,
		};
	return {
		vertical,
		reversed,
		externalLongMeasure: external.width,
		externalCrossSize: external.height,
		groupCrossSize: paddedHeight,
		groupLongMinimum: group.minimumWidth,
		edgeInset: PORT_INSET,
		groupFace: FoldedSideFace.Bottom,
		externalFace: FoldedSideFace.Top,
	};
}

export function geometryFromMeasurements(
	direction: LayoutDirection,
	measuredGroup: GroupMeasurement,
	measuredExternal: Size,
): FoldedGeometry | undefined {
	const {
		vertical,
		reversed,
		externalLongMeasure,
		externalCrossSize,
		groupCrossSize,
		groupLongMinimum,
		edgeInset,
		groupFace,
		externalFace,
	} = axisMetrics(direction, measuredGroup, measuredExternal);
	const externalLongSize = Math.max(externalLongMeasure, 2 * PORT_INSET + PORT_SPACING);
	const rankSpan = 2 * BASE_RANK_GAP;
	const edgeSpace = 2 * edgeInset;
	const groupLongSize = Math.max(groupLongMinimum, externalLongSize + rankSpan + edgeSpace);
	const lateralGap = 2 * PORT_INSET + 2 * RAIL_SPACING;
	const groupCross = OUTER_MARGIN;
	const groupFaceCross = groupCross + groupCrossSize;
	const externalFaceCross = groupFaceCross + lateralGap;
	const groupLong = OUTER_MARGIN;
	const centerLong = groupLong + groupLongSize / 2;
	const groupPortOffset = externalLongSize / 2 + BASE_RANK_GAP;
	const externalPortOffset = PORT_SPACING / 2;
	const crossRailNearGroup = groupFaceCross + PORT_INSET;
	const crossRailNearExternal = externalFaceCross - PORT_INSET;
	const endCross = externalFaceCross + externalCrossSize;
	const endLong = groupLong + groupLongSize;
	if (![groupCrossSize, externalCrossSize, groupLongSize, endCross, endLong].every(Number.isFinite))
		return undefined;

	const point = (cross: number, logicalLong: number): Point => {
		let along = logicalLong;
		if (reversed) along = 2 * centerLong - logicalLong;
		if (vertical) return { x: cross, y: along };
		return { x: along, y: cross };
	};
	const bounds = (cross: number, long: number, crossSize: number, longSize: number): Bounds => {
		if (vertical) return { x: cross, y: long, width: crossSize, height: longSize };
		return { x: long, y: cross, width: longSize, height: crossSize };
	};
	const groupBounds = bounds(groupCross, groupLong, groupCrossSize, groupLongSize);
	const externalBounds = bounds(
		externalFaceCross,
		centerLong - externalLongSize / 2,
		externalCrossSize,
		externalLongSize,
	);
	let width = endLong + OUTER_MARGIN;
	let height = endCross + OUTER_MARGIN;
	if (vertical) {
		width = endCross + OUTER_MARGIN;
		height = endLong + OUTER_MARGIN;
	}
	return {
		groupBounds,
		externalBounds,
		groupFace,
		externalFace,
		groupB: point(groupFaceCross, centerLong + groupPortOffset),
		groupA: point(groupFaceCross, centerLong - groupPortOffset),
		externalSource: point(externalFaceCross, centerLong - externalPortOffset),
		externalTarget: point(externalFaceCross, centerLong + externalPortOffset),
		leavingRailStart: point(crossRailNearExternal, centerLong + groupPortOffset),
		leavingRailEnd: point(crossRailNearExternal, centerLong + externalPortOffset),
		returningRailStart: point(crossRailNearGroup, centerLong - externalPortOffset),
		returningRailEnd: point(crossRailNearGroup, centerLong - groupPortOffset),
		width,
		height,
	};
}
