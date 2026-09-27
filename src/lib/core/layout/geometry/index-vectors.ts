/** Fair diagonals expose each leaf's second choice before exhausting another leaf. */
export function* indexVectors(
	count: number,
	total: number,
	maxIndex: (dimension: number) => number,
): Generator<readonly number[]> {
	const indices: number[] = [];
	function* visit(level: number, remaining: number): Generator<readonly number[]> {
		if (level === count) {
			if (remaining === 0) yield [...indices];
			return;
		}
		for (let index = 0; index <= Math.min(remaining, maxIndex(level)); index += 1) {
			indices.push(index);
			yield* visit(level + 1, remaining - index);
			indices.pop();
		}
	}
	yield* visit(0, total);
}
