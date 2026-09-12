import { LayoutDirection } from '../../../../lib/core/document/logic-document';
import type { Bounds } from '../../../../lib/core/layout/layout-types';

/** A box observation in layout space (VL-302, VL-220 in docs/visual-language.md). */
export interface BoxGeometry {
	readonly id: string;
	readonly bounds: Bounds;
}

interface BoxAlignmentOptions {
	readonly by: 'top' | 'centerX' | 'centerY';
	/** Absolute tolerance in layout units; numerical precision, not a product spacing. */
	readonly tolerance?: number;
}

export interface BoxAssertions {
	isAlignedWith(other: BoxGeometry, options: BoxAlignmentOptions): BoxAssertions;
	isCenteredIn(
		container: BoxGeometry,
		options: { readonly axis: 'x' | 'y' | 'both' },
	): BoxAssertions;
	isAfter(other: BoxGeometry, options: { readonly direction: LayoutDirection }): BoxAssertions;
}

function validateBox(box: BoxGeometry): void {
	const { x, y, width, height } = box.bounds;
	if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
		throw new Error(`Box "${box.id}" must have finite coordinates and positive dimensions.`);
	}
}

function coordinate(box: BoxGeometry, by: BoxAlignmentOptions['by']): number {
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

/** Alignment of explicit reference points (VL-505). Every link keeps the original subject. */
export function AssertBox(subject: BoxGeometry): BoxAssertions {
	const assertions: BoxAssertions = {
		isAlignedWith(other, { by, tolerance = 0.001 }) {
			if (!Number.isFinite(tolerance) || tolerance < 0) {
				throw new Error('Box alignment tolerance must be finite and non-negative.');
			}
			const actual = coordinate(subject, by);
			const expected = coordinate(other, by);
			const difference = Math.abs(actual - expected);
			// Require a comparable distance within tolerance; NaN must also fail the assertion.
			if (!(difference <= tolerance)) {
				throw new Error(
					`Box "${subject.id}" is not aligned with box "${other.id}" by ${by}: ` +
						`actual=${actual}, expected=${expected}, difference=${difference}, tolerance=${tolerance} (layout units).`,
				);
			}
			return assertions;
		},
		isCenteredIn(container, { axis }) {
			switch (axis) {
				case 'x':
					return assertions.isAlignedWith(container, { by: 'centerX' });
				case 'y':
					return assertions.isAlignedWith(container, { by: 'centerY' });
				case 'both':
					return assertions
						.isAlignedWith(container, { by: 'centerX' })
						.isAlignedWith(container, { by: 'centerY' });
				default:
					throw new Error(`Unsupported centering axis: ${String(axis)}`);
			}
		},
		isAfter(other, { direction }) {
			validateBox(subject);
			validateBox(other);
			const a = other.bounds;
			const b = subject.bounds;
			const gaps = {
				[LayoutDirection.TopToBottom]: b.y - (a.y + a.height),
				[LayoutDirection.BottomToTop]: a.y - (b.y + b.height),
				[LayoutDirection.LeftToRight]: b.x - (a.x + a.width),
				[LayoutDirection.RightToLeft]: a.x - (b.x + b.width),
			};
			const gap = gaps[direction];
			if (!(gap > 0))
				throw new Error(
					`Box "${subject.id}" must be after "${other.id}" in ${direction}: gap=${gap}.`,
				);
			return assertions;
		},
	};
	return assertions;
}
