import type { VisualNode } from '../harnesses/visual-layout';
import { VisualAssertionError } from './assertion-error';

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
				throw new VisualAssertionError(
					`Rang du nœud ${node.id}`,
					expected,
					node.rank,
					{ boxes: [node.id] },
					{
						code: 'node.rank',
						context: { subject: { kind: 'box', ids: [node.id] } },
						message: `Node "${node.id}": expected rank=${expected}, actual=${node.rank}.`,
					},
				);
			return assertions;
		},
	};
	return assertions;
}
