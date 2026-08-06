import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import {
	importLogicDocument,
	readLogicDocument,
} from '../../src/lib/collaboration/yjs-document-codec';
import { openDocument } from '../../src/lib/document/open-document';
import { orderKey } from '../../src/lib/document/order-key';
import { createGraph } from '../../src/lib/graph/create-graph';
import { topologicallyRank } from '../../src/lib/graph/topological-ranks';
import { weightedInversionScore } from '../../src/lib/layout/crossing-aware-order';
import { orderEndpoints } from '../../src/lib/layout/endpoint-order';
import { parseSequitToml } from '../../src/lib/text/parse-sequit-toml';
import { layoutMeasurementsForCanvas } from '../builders/layout-measurements';
import { aiDocumentaryEffortScenario } from '../scenarios/ai-documentary-effort';

const twoByTwoInversionDocument = `
persistenceFormat = 2

[document]
id = "two-by-two-inversion"
title = "Two by two inversion"

[layout]
direction = "top-to-bottom"
bias = "top"

[natures.goal]
label = "Goal"
color = "#12c930"

[groups]

[nodes.source-a]
nature = "goal"
markdown = "Source A"
layoutOrder = "a0"

[nodes.source-b]
nature = "goal"
markdown = "Source B"
layoutOrder = "a1"

[nodes.target-a]
nature = "goal"
markdown = "Target A"
layoutOrder = "a2"

[nodes.target-b]
nature = "goal"
markdown = "Target B"
layoutOrder = "a3"

[nodes.target-c]
nature = "goal"
markdown = "Target C"
layoutOrder = "a4"

[nodes.successor]
nature = "goal"
markdown = "Successor"
layoutOrder = "a5"

[junctions]

[relations.source-a-to-target-b]
from = "source-a"
to = "target-b"

[relations.source-b-to-target-a]
from = "source-b"
to = "target-a"

[relations.source-b-to-target-c]
from = "source-b"
to = "target-c"

[relations.target-a-to-successor]
from = "target-a"
to = "successor"

[relations.target-b-to-successor]
from = "target-b"
to = "successor"

[relations.target-c-to-successor]
from = "target-c"
to = "successor"
`;

function expectDocument<T>(result: { ok: boolean; value?: T }): T {
	expect(result.ok).toBe(true);
	if (!result.ok || result.value === undefined) throw new Error('Expected a valid document');
	return result.value;
}

function orderedIds(
	nodes: readonly { readonly id: string; readonly bounds: { readonly x: number } }[],
	ids: readonly string[],
): readonly string[] {
	const included = new Set(ids);
	return nodes
		.filter(({ id }) => included.has(id))
		.toSorted((left, right) => left.bounds.x - right.bounds.x)
		.map(({ id }) => id);
}

function pointTouchesBoundary(
	point: { readonly x: number; readonly y: number },
	bounds: {
		readonly x: number;
		readonly y: number;
		readonly width: number;
		readonly height: number;
	},
): boolean {
	const tolerance = 0.001;
	const right = bounds.x + bounds.width;
	const bottom = bounds.y + bounds.height;
	const withinX = point.x >= bounds.x - tolerance && point.x <= right + tolerance;
	const withinY = point.y >= bounds.y - tolerance && point.y <= bottom + tolerance;
	return (
		(withinX &&
			(Math.abs(point.y - bounds.y) < tolerance || Math.abs(point.y - bottom) < tolerance)) ||
		(withinY && (Math.abs(point.x - bounds.x) < tolerance || Math.abs(point.x - right) < tolerance))
	);
}

describe('AI for documentary effort', () => {
	describe('when the persistent document is opened', () => {
		it('renders its complete dependency graph through the application use case', async () => {
			const source = await aiDocumentaryEffortScenario();

			const projection = expectDocument(openDocument(source));
			const canvas = await projection.createCanvasModel(
				layoutMeasurementsForCanvas(projection.measurementModel),
			);

			expect(projection.measurementModel.nodes).toHaveLength(24);
			expect(canvas.nodes).toHaveLength(24);
			expect(canvas.groups).toHaveLength(2);
			expect(canvas.junctions).toEqual([
				expect.objectContaining({ id: 'word-ui-options', operator: 'xor' }),
			]);
			expect(canvas.relations).toHaveLength(20);
			expect(canvas.nodes.find(({ id }) => id === 'traceable-edits')?.markdown).toBe(
				'ALCOA+: All edits needs to be tracable\n',
			);
			expect(canvas.groups).toContainEqual(
				expect.objectContaining({ id: 'data-team', label: 'Data team' }),
			);
			expect(canvas.width).toBeGreaterThan(0);
			expect(canvas.height).toBeGreaterThan(0);
			projection.destroy();
		});

		it('keeps the improved reference order stable across reopen and Yjs snapshots', async () => {
			const source = await aiDocumentaryEffortScenario();
			const firstOpened = expectDocument(openDocument(source));
			const reopened = expectDocument(openDocument(source));
			const firstCanvas = await firstOpened.createCanvasModel(
				layoutMeasurementsForCanvas(firstOpened.measurementModel),
			);
			const reopenedCanvas = await reopened.createCanvasModel(
				layoutMeasurementsForCanvas(reopened.measurementModel),
			);
			const improvedLine = [
				'preserve-documentary-guarantees',
				'minimal-workflow-disruption',
				'ai-content-generation',
			];

			expect(orderedIds(firstCanvas.nodes, improvedLine)).toEqual(improvedLine);
			expect(orderedIds(reopenedCanvas.nodes, improvedLine)).toEqual(improvedLine);

			const parsed = parseSequitToml(source);
			if (!parsed.ok) throw new Error('Reference document must parse');
			const live = new Y.Doc();
			importLogicDocument(live, parsed.value);
			const snapshot = new Y.Doc();
			Y.applyUpdate(snapshot, Y.encodeStateAsUpdate(live));
			const reconstructed = readLogicDocument(snapshot);
			expect(reconstructed.ok).toBe(true);
			if (!reconstructed.ok) throw new Error('Reference snapshot must reconstruct');
			expect(reconstructed.value).toEqual(parsed.value);

			firstOpened.destroy();
			reopened.destroy();
		});

		it('strictly reduces weighted inversions on the reported third line', async () => {
			const parsed = parseSequitToml(await aiDocumentaryEffortScenario());
			if (!parsed.ok) throw new Error('Reference document must parse');
			const current = parsed.value;
			const legacyOrder = new Map([
				['ai-content-generation', orderKey('a5')],
				['minimal-workflow-disruption', orderKey('a6')],
				['preserve-documentary-guarantees', orderKey('a7')],
			]);
			const before = {
				...current,
				nodes: current.nodes.map((node) => ({
					...node,
					layoutOrder: legacyOrder.get(node.id) ?? node.layoutOrder,
				})),
			};
			const score = (document: typeof current) => {
				const graph = createGraph(document);
				if (!graph.ok) throw new Error('Reference graph must be valid');
				const ranks = topologicallyRank(graph.value);
				return weightedInversionScore({
					effectiveRelations: graph.value.effectiveRelations,
					effectiveEndpointOrder: orderEndpoints([
						...document.groups,
						...document.nodes,
						...document.junctions,
					]),
					ranks: ranks.byEndpointId,
					junctionIds: new Set(document.junctions.map(({ id }) => id)),
				});
			};

			expect(score(current)).toBeLessThan(score(before));
		});

		it('appends isolated nodes after established comparable peers in addition order', async () => {
			const opened = expectDocument(openDocument(await aiDocumentaryEffortScenario()));
			const before = await opened.createCanvasModel(
				layoutMeasurementsForCanvas(opened.measurementModel),
			);
			const establishedPeerIds = [
				'alcoa-plus',
				'docx-word-compatible',
				'preserve-partner-content',
				'prompt-management',
			];
			const establishedX = new Map(
				before.nodes
					.filter(({ id }) => establishedPeerIds.includes(id))
					.map(({ id, bounds }) => [id, bounds.x]),
			);

			await opened.addNode({
				id: 'zz-added-first',
				natureId: 'goal',
				markdown: 'Added first',
			});
			await opened.addNode({
				id: 'aa-added-second',
				natureId: 'goal',
				markdown: 'Added second',
			});
			const after = await opened.createCanvasModel(
				layoutMeasurementsForCanvas(opened.measurementModel),
			);
			const first = after.nodes.find(({ id }) => id === 'zz-added-first');
			const second = after.nodes.find(({ id }) => id === 'aa-added-second');
			const establishedAfter = after.nodes.filter(({ id }) => establishedPeerIds.includes(id));

			expect(first?.bounds.x).toBeGreaterThan(
				Math.max(...establishedAfter.map(({ bounds }) => bounds.x)),
			);
			expect(first?.bounds.x).toBeLessThan(second?.bounds.x ?? 0);
			expect(first?.bounds.y).toBe(second?.bounds.y);
			expect(new Map(establishedAfter.map(({ id, bounds }) => [id, bounds.x]))).toEqual(
				establishedX,
			);
		});

		it('removes a visible two-by-two inversion through the public relation editing path', async () => {
			const opened = expectDocument(openDocument(twoByTwoInversionDocument));
			const before = await opened.createCanvasModel(
				layoutMeasurementsForCanvas(opened.measurementModel),
			);

			await opened.addRelation({
				id: 'qualifying-source-b-to-target-a',
				from: 'source-b',
				to: 'target-a',
			});
			const after = await opened.createCanvasModel(
				layoutMeasurementsForCanvas(opened.measurementModel),
			);
			const beforeBounds = new Map(before.nodes.map(({ id, bounds }) => [id, bounds]));
			const afterBounds = new Map(after.nodes.map(({ id, bounds }) => [id, bounds]));
			const links = [
				{
					relationId: 'source-a-to-target-b',
					sourceId: 'source-a',
					targetId: 'target-b',
					weight: 1,
				},
				{
					relationId: 'source-b-to-target-a',
					sourceId: 'source-b',
					targetId: 'target-a',
					weight: 1,
				},
				{
					relationId: 'qualifying-source-b-to-target-a',
					sourceId: 'source-b',
					targetId: 'target-a',
					weight: 1,
				},
				{
					relationId: 'source-b-to-target-c',
					sourceId: 'source-b',
					targetId: 'target-c',
					weight: 1,
				},
			];
			const ranks = new Map([
				['source-a', 0],
				['source-b', 0],
				['target-a', 1],
				['target-b', 1],
				['target-c', 1],
			]);
			const score = (endpointOrder: readonly string[]) =>
				weightedInversionScore({
					effectiveRelations: links.map(({ relationId, sourceId, targetId }) => ({
						relationId,
						sourceIds: [sourceId],
						targetIds: [targetId],
					})),
					effectiveEndpointOrder: endpointOrder,
					ranks,
					junctionIds: new Set(),
				});

			const beforeOrder = orderedIds(before.nodes, [
				'source-a',
				'source-b',
				'target-a',
				'target-b',
				'target-c',
			]);
			const afterOrder = orderedIds(after.nodes, [
				'source-a',
				'source-b',
				'target-a',
				'target-b',
				'target-c',
			]);
			expect(orderedIds(before.nodes, ['target-a', 'target-b', 'target-c'])).toEqual([
				'target-a',
				'target-b',
				'target-c',
			]);
			expect(orderedIds(after.nodes, ['target-a', 'target-b', 'target-c'])).toEqual([
				'target-b',
				'target-a',
				'target-c',
			]);
			expect(orderedIds(before.nodes, ['target-b', 'target-c'])).toEqual(
				orderedIds(after.nodes, ['target-b', 'target-c']),
			);
			expect(score(afterOrder)).toBeLessThan(score(beforeOrder));

			for (const canvas of [before, after]) {
				const bounds = new Map(canvas.nodes.map(({ id, bounds: nodeBounds }) => [id, nodeBounds]));
				for (const relation of canvas.relations) {
					expect(relation.points).toHaveLength(4);
					for (let index = 1; index < relation.points.length; index += 1) {
						const previous = relation.points[index - 1];
						const current = relation.points[index];
						if (previous === undefined || current === undefined)
							throw new Error(`Missing routed point for ${relation.id}`);
						expect(previous.x === current.x || previous.y === current.y).toBe(true);
					}
					const fromBounds = bounds.get(relation.from);
					const toBounds = bounds.get(relation.to);
					const firstPoint = relation.points[0];
					const lastPoint = relation.points.at(-1);
					if (firstPoint === undefined || lastPoint === undefined)
						throw new Error(`Missing boundary point for ${relation.id}`);
					if (!fromBounds || !toBounds) {
						throw new Error(`Missing geometry for relation ${relation.id}`);
					}
					expect(pointTouchesBoundary(firstPoint, fromBounds)).toBe(true);
					expect(pointTouchesBoundary(lastPoint, toBounds)).toBe(true);
				}
			}
			expect(after.relations.find(({ id }) => id === 'source-b-to-target-c')?.points).toEqual(
				before.relations.find(({ id }) => id === 'source-b-to-target-c')?.points,
			);
			expect(afterBounds.get('source-a')).toEqual(beforeBounds.get('source-a'));
			expect(afterBounds.get('source-b')).toEqual(beforeBounds.get('source-b'));
		});
	});
});
