import { describe, expect, it } from 'vitest';

import { EndpointKind } from '../../../src/lib/core/document/logic-document';
import { AssertNode } from './assert-node';

const node = {
	id: 'a',
	kind: EndpointKind.Node,
	rank: 2,
	bounds: { x: 40, y: 40, width: 100, height: 60 },
};

describe('AssertNode', () => {
	it('checks rank and keeps the original subject for fluent calls', () => {
		const assertions = AssertNode(node);
		expect(assertions.hasRank(2).hasRank(2)).toBe(assertions);
		expect(() => assertions.hasRank(1)).toThrow('Node "a": expected rank=1, actual=2.');
	});
	it.each([0, -1, 1.5, Number.NaN])('rejects invalid expected rank %s', (rank) => {
		expect(() => AssertNode(node).hasRank(rank)).toThrow(
			'Expected rank must be a positive integer.',
		);
	});
});
