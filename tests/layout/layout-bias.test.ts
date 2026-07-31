import { describe, expect, it } from 'vitest';

import {
	ISOLATED_BRANCH,
	LAYOUT_CONFIGURATIONS,
	LAYOUT_CONTEXTS,
	layoutBiasScenario,
	LONG_BRANCH,
	SHORT_BRANCH,
} from '../builders/layout-bias-scenario';
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

describe.each(LAYOUT_CONTEXTS)('layout bias in %s', (context) => {
	it.each(LAYOUT_CONFIGURATIONS)(
		'places branch-local maximum ranks toward $bias with $direction orientation',
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

			const longEnvelope = envelopeFor(layout, LONG_BRANCH);
			const shortEnvelope = envelopeFor(layout, SHORT_BRANCH);
			const isolatedEnvelope = envelopeFor(layout, ISOLATED_BRANCH);
			const biasedCoordinate = coordinateAt(longEnvelope, configuration.bias);
			expect
				.soft(coordinateAt(shortEnvelope, configuration.bias), 'short branch bias')
				.toBe(biasedCoordinate);
			expect
				.soft(coordinateAt(isolatedEnvelope, configuration.bias), 'isolated branch bias')
				.toBe(biasedCoordinate);

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

			let immediateContainerId = 'nested-container';
			if (context === 'group') immediateContainerId = 'container';
			const immediateContainer = boundsFor(layout, immediateContainerId);
			expect.soft(contains(immediateContainer, nodesEnvelope)).toBe(true);
			if (context === 'subgroup') {
				expect.soft(contains(boundsFor(layout, 'container'), immediateContainer)).toBe(true);
			}
		},
	);
});
