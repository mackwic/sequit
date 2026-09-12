import type { LayoutDirection } from '../../../src/lib/core/document/logic-document';
import { type BoxGeometry, coordinate, gapAfter, identityOf } from '../harnesses/box-geometry';
import { VisualAssertionError } from './assertion-error';
export type { BoxGeometry } from '../harnesses/box-geometry';

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

function assertAlignment(
	subject: BoxGeometry,
	other: BoxGeometry,
	{ by, tolerance = 0.001 }: BoxAlignmentOptions,
	operation: 'box.alignment' | 'box.centering',
): void {
	if (!Number.isFinite(tolerance) || tolerance < 0) {
		throw new Error('Box alignment tolerance must be finite and non-negative.');
	}
	const actual = coordinate(subject, by);
	const expected = coordinate(other, by);
	const difference = Math.abs(actual - expected);
	// Require a comparable distance within tolerance; NaN must also fail the assertion.
	if (!(difference <= tolerance)) {
		let measuredAxis: 'x' | 'y' = 'x';
		if (by !== 'centerX') measuredAxis = 'y';
		throw new VisualAssertionError(
			`Alignement de ${subject.id} sur ${other.id}`,
			expected,
			actual,
			{ boxes: identityOf(subject).ids, referenceBoxes: identityOf(other).ids },
			{
				code: operation,
				context: {
					subject: identityOf(subject),
					reference: identityOf(other),
					axis: measuredAxis,
					tolerance,
					difference,
				},
				message: `Box "${subject.id}" is not aligned with box "${other.id}" by ${by}: actual=${actual}, expected=${expected}, difference=${difference}, tolerance=${tolerance} (layout units).`,
			},
		);
	}
}

/** Every link keeps the original subject. Centering compares centers, without implying containment. */
export function AssertBox(subject: BoxGeometry): BoxAssertions {
	const assertions: BoxAssertions = {
		isAlignedWith(other, options) {
			assertAlignment(subject, other, options, 'box.alignment');
			return assertions;
		},
		isCenteredIn(container, { axis }) {
			switch (axis) {
				case 'x':
					assertAlignment(subject, container, { by: 'centerX' }, 'box.centering');
					break;
				case 'y':
					assertAlignment(subject, container, { by: 'centerY' }, 'box.centering');
					break;
				case 'both':
					assertAlignment(subject, container, { by: 'centerX' }, 'box.centering');
					assertAlignment(subject, container, { by: 'centerY' }, 'box.centering');
					break;
				default:
					throw new Error(`Unsupported centering axis: ${String(axis)}`);
			}
			return assertions;
		},
		isAfter(other, { direction }) {
			const gap = gapAfter(subject, other, direction);
			if (!(gap > 0))
				throw new VisualAssertionError(
					`Position de ${subject.id} après ${other.id}`,
					'espace strictement positif',
					gap,
					{ boxes: identityOf(subject).ids, referenceBoxes: identityOf(other).ids },
					{
						code: 'box.order',
						context: { subject: identityOf(subject), reference: identityOf(other), direction },
						message: `Box "${subject.id}" must be after "${other.id}" in ${direction}: gap=${gap}.`,
					},
				);
			return assertions;
		},
	};
	return assertions;
}
