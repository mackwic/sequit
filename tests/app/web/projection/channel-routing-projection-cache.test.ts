import { describe, expect, it } from 'vitest';

import {
	createProjectionLayoutCaches,
	layoutGraph,
	layoutGraphForProjection,
	type Size,
} from '../../../../src/app/web/projection/layout-graph';
import { applyLayoutPerformanceInsertion } from '../../../../src/app/workshop/fixtures/layout-performance/apply-layout-performance-insertion';
import { LAYOUT_PERFORMANCE_SCENARIOS } from '../../../../src/app/workshop/fixtures/layout-performance/scenarios';
import {
	defined,
	EndpointKind,
	layoutConfiguration,
	LayoutDirection,
	type LogicDocument,
	PERSISTENCE_FORMAT,
} from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import { RegionLocalLayoutCache } from '../../../../src/lib/core/layout/regions/model/region-local-cache';
import { ChannelRoutingCache } from '../../../../src/lib/core/layout/routing/channel-routing-cache';
import type {
	ChannelRouting,
	ChannelWire,
} from '../../../../src/lib/core/layout/routing/channel-types';
import { prepareLayoutDocument } from '../../../support/harnesses/layout';
import { defaultBiasFor } from '../../../support/harnesses/visual-directions';

/** Its bottom-to-top corner corridor holds a shared-source family and a split wire. */
function splitFamilyDocument(): LogicDocument {
	const direction = LayoutDirection.BottomToTop;
	const relations = [
		['r0', 'n0', 'n2'],
		['r1', 'n1', 'n3'],
		['r3', 'n4', 'n5'],
		['r4', 'n2', 'n6'],
		['r4', 'n3', 'n7'],
		['r5', 'n3', 'n5'],
	] as const;
	return {
		persistenceFormat: PERSISTENCE_FORMAT,
		id: 'channel-cache-split-family',
		title: 'Channel cache split family',
		layout: defined(layoutConfiguration(direction, defaultBiasFor(direction))),
		natures: [{ id: 'goal', label: 'Goal', color: '#00aa44' }],
		groups: [],
		nodes: Array.from({ length: 8 }, (_, index) => ({
			kind: EndpointKind.Node,
			id: `n${index}`,
			natureId: 'goal',
			markdown: `n${index}\n`,
			layoutOrder: orderKey(`a000${index}1`),
		})),
		junctions: [],
		relations: relations.map(([id, from, to]) => ({ id: `${id}-${from}-${to}`, from, to })),
	};
}

/** Keeps the channels it replays from a remembered routing. */
class RecordingChannelCache extends ChannelRoutingCache {
	readonly replayed: ChannelRouting[] = [];

	override route(wires: ChannelWire[], nonInverted: boolean, ownerId: string): ChannelRouting {
		const hits = this.stats.hits;
		const routing = super.route(wires, nonInverted, ownerId);
		if (this.stats.hits > hits) this.replayed.push(routing);
		return routing;
	}
}

describe('projection-owned channel routing cache', () => {
	it.each([
		['wide-bipartite-layers', 60],
		['unbalanced-random', 40],
	] as const)(
		'keeps %s projection layouts equal to cold layouts through %i insertions',
		async (name, nodeCount) => {
			const builder = LAYOUT_PERFORMANCE_SCENARIOS.find(
				(scenario) => scenario.name === name,
			)?.createBuilder();
			if (builder === undefined) throw new Error(`Missing scenario ${name}`);
			const caches = createProjectionLayoutCaches();
			let document = builder.buildInitialDocument();
			for (const insertion of builder.buildInsertions(nodeCount)) {
				document = applyLayoutPerformanceInsertion(document, insertion);
				const { graph, ranks, measurements } = prepareLayoutDocument(document);
				const incremental = await layoutGraphForProjection(graph, ranks, measurements, caches);
				expect(incremental, `insertion ${insertion.nodeIndex}`).toStrictEqual(
					await layoutGraph(graph, ranks, measurements),
				);
			}
			expect(caches.channels.stats.hits).toBeGreaterThan(0);
		},
		60_000,
	);

	it('replays a corner channel with a split wire and a shared-source family equal to a cold layout', async () => {
		const channels = new RecordingChannelCache();
		const caches = { regions: new RegionLocalLayoutCache(), channels };
		const document = splitFamilyDocument();
		const resizes: readonly Readonly<Record<string, Size>>[] = [
			{ n6: { width: 168, height: 116 } },
			{ n6: { width: 168, height: 116 }, n7: { width: 171, height: 116 } },
			{ n6: { width: 168, height: 116 }, n7: { width: 171, height: 116 } },
		];
		for (const [step, nodes] of resizes.entries()) {
			const { graph, ranks, measurements } = prepareLayoutDocument(document, { nodes });
			expect(
				await layoutGraphForProjection(graph, ranks, measurements, caches),
				`step ${step}`,
			).toStrictEqual(await layoutGraph(graph, ranks, measurements));
		}
		expect(
			channels.replayed.some(
				({ wires }) =>
					wires.some(({ middle }) => middle !== undefined) &&
					wires.some(({ sharedSource }) => sharedSource !== undefined),
			),
		).toBe(true);
	});
});
