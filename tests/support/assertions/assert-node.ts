import type { VisualNode } from '../harnesses/visual-layout';

interface NodeAssertions {
	hasRank(expected: number): NodeAssertions;
}

/** Logical node rank (VL-117), numbered from 1 in the harness. */
export function AssertNode(node: VisualNode): NodeAssertions {
	const assertions: NodeAssertions = {
		hasRank(expected) {
			if (!Number.isInteger(expected) || expected < 1)
				throw new Error('Expected rank must be a positive integer.');
			if (node.rank !== expected)
				throw new Error(`Node "${node.id}": expected rank=${expected}, actual=${node.rank}.`);
			return assertions;
		},
	};
	return assertions;
}
