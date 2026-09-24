import type { JointK32Input } from './joint-k32-contract';

const faceMetrics = ['d', 'e'].map((endpointId) => ({
	endpointId,
	intrinsicCrossSize: 80,
	inset: 24,
	spacing: 48,
}));

const candidates = [
	{
		id: 'adjacent-d-before-e',
		sourceRank: 1,
		targetRank: 0,
		sourceOrder: ['a', 'b', 'c'],
		targetOrder: ['d', 'e'],
		passage: 'monotone-adjacent-corridor',
	},
	{
		id: 'adjacent-e-before-d',
		sourceRank: 1,
		targetRank: 0,
		sourceOrder: ['a', 'b', 'c'],
		targetOrder: ['e', 'd'],
		passage: 'monotone-adjacent-corridor',
	},
	{
		id: 'outside-corridor',
		sourceRank: 1,
		targetRank: 0,
		sourceOrder: ['a', 'b', 'c'],
		targetOrder: ['d', 'e'],
		passage: 'other-passage',
	},
] as const satisfies JointK32Input['candidates'];

/** Every source has an arrival at each target. */
export function completeJointK32Fixture(): JointK32Input {
	return {
		sourceIds: ['a', 'b', 'c'],
		targetIds: ['d', 'e'],
		relations: ['a', 'b', 'c'].flatMap((from) =>
			['d', 'e'].map((to) => ({ id: `${from}-${to}`, from, to })),
		),
		faceMetrics,
		candidates,
	};
}

/** One target has three arrivals; reversing target order changes its capacity demand. */
export function sparseJointCorridorFixture(): JointK32Input {
	return {
		sourceIds: ['a', 'b', 'c'],
		targetIds: ['d', 'e'],
		relations: [
			{ id: 'a-d', from: 'a', to: 'd' },
			{ id: 'b-d', from: 'b', to: 'd' },
			{ id: 'c-d', from: 'c', to: 'd' },
			{ id: 'a-e', from: 'a', to: 'e' },
		],
		faceMetrics,
		candidates,
	};
}
