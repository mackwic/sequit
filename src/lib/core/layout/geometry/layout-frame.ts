import { LayoutBias, LayoutDirection } from '../../document/logic-document';
import type { Bounds, Point, Size } from '../layout-types';

/** Coordinates owned by one layout call. Never borrowed from measurements or previous results. */
export interface MutableBounds {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface LayoutFrame {
	readonly direction: LayoutDirection;
	readonly vertical: boolean;
	readonly forward: boolean;
	readonly biasAtStart: boolean;
}

export function isVerticalDirection(direction: LayoutDirection): boolean {
	return direction === LayoutDirection.TopToBottom || direction === LayoutDirection.BottomToTop;
}

export function createLayoutFrame(direction: LayoutDirection, bias: LayoutBias): LayoutFrame {
	return {
		direction,
		vertical: isVerticalDirection(direction),
		forward: direction === LayoutDirection.TopToBottom || direction === LayoutDirection.LeftToRight,
		biasAtStart: bias === LayoutBias.Top || bias === LayoutBias.Left,
	};
}

export function mainSize(size: Size, vertical: boolean): number {
	if (vertical) return size.height;
	return size.width;
}

export function transverseSize(size: Size, vertical: boolean): number {
	if (vertical) return size.width;
	return size.height;
}

export function mainStart(box: Bounds, vertical: boolean): number {
	if (vertical) return box.y;
	return box.x;
}

export function transverseStart(box: Bounds, vertical: boolean): number {
	if (vertical) return box.x;
	return box.y;
}

export function transverseCenter(box: Bounds, vertical: boolean): number {
	return transverseStart(box, vertical) + transverseSize(box, vertical) / 2;
}

export function pointOnAxes(transverse: number, main: number, vertical: boolean): Point {
	if (vertical) return { x: transverse, y: main };
	return { x: main, y: transverse };
}

export function boundsOnAxes(
	transverse: number,
	main: number,
	size: Size,
	vertical: boolean,
): MutableBounds {
	if (vertical) return { x: transverse, y: main, ...size };
	return { x: main, y: transverse, ...size };
}

export function translateBounds(box: MutableBounds, x: number, y: number): void {
	box.x += x;
	box.y += y;
}

export function translateTransversely(
	box: MutableBounds,
	distance: number,
	vertical: boolean,
): void {
	if (vertical) box.x += distance;
	else box.y += distance;
}

export function biasedMainStart(length: number, maximum: number, frame: LayoutFrame): number {
	if (frame.biasAtStart) return 0;
	return maximum - length;
}
