function sortedSample(values: readonly number[]): number[] {
	if (values.length === 0) throw new Error('Cannot calculate statistics for an empty sample');
	return [...values].sort((left, right) => left - right);
}

function valueAt(values: readonly number[], index: number): number {
	const value = values.at(index);
	if (value === undefined) throw new Error('Statistic index is outside the sample');
	return value;
}

export function median(values: readonly number[]): number {
	const sorted = sortedSample(values);
	const middle = Math.floor(sorted.length / 2);
	if (sorted.length % 2 === 1) return valueAt(sorted, middle);
	return (valueAt(sorted, middle - 1) + valueAt(sorted, middle)) / 2;
}

export function percentile(values: readonly number[], percentage: number): number {
	if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) {
		throw new Error('Percentile must be a finite number between 0 and 100');
	}

	const sorted = sortedSample(values);
	// Nearest-rank selection makes p95 the value at ceil(0.95 * sample size), counting from one.
	const rank = Math.max(1, Math.ceil((percentage / 100) * sorted.length));
	return valueAt(sorted, rank - 1);
}

export function maximum(values: readonly number[]): number {
	return valueAt(sortedSample(values), -1);
}
