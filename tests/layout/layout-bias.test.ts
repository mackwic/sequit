import { describe, expect, it } from 'vitest';

import {
	ISOLATED_BRANCH,
	LAYOUT_CONFIGURATIONS,
	LAYOUT_CONTEXTS,
	layoutBiasScenario,
	LONG_BRANCH,
	SHORT_BRANCH,
} from '../builders/layout-bias-scenario';
import { validLogicDocument } from '../builders/logic-document';
import {
	boundsFor,
	contains,
	coordinateAt,
	envelopeFor,
	layoutDocument,
	overlaps,
	progressesFromTo,
} from '../harnesses/layout';

const ALL_NODES = [...LONG_BRANCH, ...SHORT_BRANCH, ...ISOLATED_BRANCH] as const;
const LONG_RELATIONS = [
	['long-0', 'long-1'],
	['long-1', 'long-2'],
	['long-2', 'long-3'],
] as const;
const SHORT_RELATIONS = [['short-0', 'short-1']] as const;

describe.each(LAYOUT_CONFIGURATIONS)(
	'aligns variable-size boxes within a rank toward $bias with $direction orientation',
	(configuration) => {
		it('uses the biased edge instead of centering boxes in the rank band', async () => {
			const base = validLogicDocument();
			const document = { ...base, layout: configuration };
			const layout = (
				await layoutDocument(document, {
					nodes: {
						'source-a': { width: 140, height: 52 },
						'source-b': { width: 220, height: 116 },
					},
				})
			).layout;

			expect(coordinateAt(boundsFor(layout, 'source-a'), configuration.bias)).toBe(
				coordinateAt(boundsFor(layout, 'source-b'), configuration.bias),
			);
		});
	},
);

describe.each(LAYOUT_CONTEXTS)('layout bias in %s', (context) => {
	it.each(LAYOUT_CONFIGURATIONS)(
		'aligns global ranks toward $bias with $direction orientation',
		async (configuration) => {
			const fixture = await layoutDocument(layoutBiasScenario(configuration, context));
			const { layout } = fixture;

			for (const [sourceId, targetId] of [...LONG_RELATIONS, ...SHORT_RELATIONS]) {
				expect
					.soft(
						progressesFromTo(
							boundsFor(layout, sourceId),
							boundsFor(layout, targetId),
							configuration.direction,
						),
						`${sourceId} -> ${targetId} must progress ${configuration.direction}`,
					)
					.toBe(true);
			}

			for (const ids of [
				['long-0', 'short-0', 'isolated'],
				['long-1', 'short-1'],
			]) {
				const biasedCoordinate = coordinateAt(boundsFor(layout, ids[0] ?? ''), configuration.bias);
				expect(ids.map((id) => coordinateAt(boundsFor(layout, id), configuration.bias))).toEqual(
					ids.map(() => biasedCoordinate),
				);
			}

			for (let leftIndex = 0; leftIndex < ALL_NODES.length; leftIndex += 1) {
				for (let rightIndex = leftIndex + 1; rightIndex < ALL_NODES.length; rightIndex += 1) {
					const leftId = ALL_NODES[leftIndex];
					const rightId = ALL_NODES[rightIndex];
					expect.soft(overlaps(boundsFor(layout, leftId), boundsFor(layout, rightId))).toBe(false);
				}
			}

			const nodesEnvelope = envelopeFor(layout, ALL_NODES);
			if (context === 'root') {
				expect
					.soft(contains({ x: 0, y: 0, width: layout.width, height: layout.height }, nodesEnvelope))
					.toBe(true);
				return;
			}

			const immediateContainerId = context === 'group' ? 'container' : 'nested-container';
			const immediateContainer = boundsFor(layout, immediateContainerId);
			expect.soft(contains(immediateContainer, nodesEnvelope)).toBe(true);
			if (context === 'subgroup') {
				expect.soft(contains(boundsFor(layout, 'container'), immediateContainer)).toBe(true);
			}
		},
	);
});
