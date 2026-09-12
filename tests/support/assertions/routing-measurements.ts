import type { Bounds } from '../../../src/lib/core/layout/layout-types';
import { type AssertionTargets, VisualAssertionError } from './assertion-error';

export type Axis = 'x' | 'y';
const PRECISION = 0.001;

export function extent(bounds: Bounds, axis: Axis): number {
	if (axis === 'x') return bounds.width;
	return bounds.height;
}

export function equalMetric(
	label: string,
	actual: number,
	expected: number,
	targets: AssertionTargets = {},
): void {
	if (!Number.isFinite(actual) || Math.abs(actual - expected) > PRECISION)
		throw new VisualAssertionError(label, expected, actual, targets);
}

export function minimumMetric(
	label: string,
	actual: number,
	minimum: number,
	targets: AssertionTargets = {},
): void {
	if (!Number.isFinite(actual) || actual + PRECISION < minimum)
		throw new VisualAssertionError(label, `minimum=${minimum}`, actual, targets);
}

export function distinctCoordinates(values: readonly number[]): number[] {
	const result: number[] = [];
	for (const value of [...values].sort((a, b) => a - b)) {
		if (!Number.isFinite(value)) throw new Error('Coordonnée non finie.');
		const previous = result.at(-1);
		if (previous === undefined || value - previous > PRECISION) result.push(value);
	}
	return result;
}
