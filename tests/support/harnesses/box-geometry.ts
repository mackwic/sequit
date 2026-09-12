import { LayoutDirection } from '../../../src/lib/core/document/logic-document';
import type { Bounds } from '../../../src/lib/core/layout/layout-types';

export interface BoxIdentity {
	readonly kind: 'box' | 'envelope' | 'frame';
	readonly ids: readonly string[];
}

/** A measured box retains the identities which produced it, independently of assertions. */
export interface BoxGeometry {
	readonly id: string;
	readonly bounds: Bounds;
	readonly identity?: BoxIdentity;
}

export function identityOf(box: BoxGeometry): BoxIdentity {
	return box.identity ?? { kind: 'box', ids: [box.id] };
}

export function validateBox(box: BoxGeometry): void {
	const { x, y, width, height } = box.bounds;
	if (
		![x, y, width, height, x + width, y + height].every(Number.isFinite) ||
		width <= 0 ||
		height <= 0
	) {
		throw new Error(`Box "${box.id}" must have finite coordinates and positive dimensions.`);
	}
}

export function coordinate(box: BoxGeometry, by: 'top' | 'centerX' | 'centerY'): number {
	validateBox(box);
	switch (by) {
		case 'top':
			return box.bounds.y;
		case 'centerX':
			return box.bounds.x + box.bounds.width / 2;
		case 'centerY':
			return box.bounds.y + box.bounds.height / 2;
		default:
			throw new Error(`Unsupported box alignment: ${String(by)}`);
	}
}

export function gapAfter(
	subject: BoxGeometry,
	reference: BoxGeometry,
	direction: LayoutDirection,
): number {
	validateBox(subject);
	validateBox(reference);
	const a = reference.bounds;
	const b = subject.bounds;
	return {
		[LayoutDirection.TopToBottom]: b.y - (a.y + a.height),
		[LayoutDirection.BottomToTop]: a.y - (b.y + b.height),
		[LayoutDirection.LeftToRight]: b.x - (a.x + a.width),
		[LayoutDirection.RightToLeft]: a.x - (b.x + b.width),
	}[direction];
}
