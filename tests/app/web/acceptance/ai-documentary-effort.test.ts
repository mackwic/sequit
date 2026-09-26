import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { openDocument } from '../../../../src/app/web/projection/open-document';
import { defined } from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import { createGraph } from '../../../../src/lib/core/graph/create-graph';
import { topologicallyRank } from '../../../../src/lib/core/graph/topological-ranks';
import { scoreDedicatedCandidateRoutes } from '../../../../src/lib/core/layout/dedicated-candidate-validation/route-score';
import { evaluateDedicatedLayout } from '../../../../src/lib/core/layout/layout-engine';
import { weightedInversionScore } from '../../../../src/lib/core/layout/rank/crossing-aware-order';
import { prepareLayout } from '../../../../src/lib/core/layout/structure/prepare-layout';
import { orderEndpoints } from '../../../../src/lib/core/ordering/endpoint-order';
import {
	importLogicDocument,
	readLogicDocument,
} from '../../../../src/lib/infrastructure/collaboration/yjs-document-codec';
import { parseSequitToml } from '../../../../src/lib/infrastructure/toml/parse-sequit-toml';
import { AssertRoute } from '../../../support/assertions/assert-route';
import { AssertRoutes } from '../../../support/assertions/assert-routes';
import { AssertTrunks } from '../../../support/assertions/assert-trunks';
import { layoutMeasurementsForCanvas } from '../../../support/builders/layout-measurements';
import { twoByTwoInversionDocument } from '../../../support/fixtures';
import { aiDocumentaryEffortScenario } from '../../../support/scenarios/ai-documentary-effort';

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

		it('preserves an unrelated shared arrival trunk when a bypass is added', async () => {
			const opened = expectDocument(openDocument(await aiDocumentaryEffortScenario()));
			const before = await opened.createCanvasModel(
				layoutMeasurementsForCanvas(opened.measurementModel),
			);
			await opened.addRelation({
				id: 'freshness-tracking-to-documents-live-18-months',
				from: 'freshness-tracking',
				to: 'documents-live-18-months',
			});
			const after = await opened.createCanvasModel(
				layoutMeasurementsForCanvas(opened.measurementModel),
			);
			const routesToInterdependentSections = (canvas: typeof before) =>
				[
					'ai-generation-orchestration-to-interdependent-sections',
					'conclusion-section-example-to-interdependent-sections',
				].map((id) => defined(canvas.relations.find((relation) => relation.id === id)));

			AssertTrunks(routesToInterdependentSections(before)).haveSharedSegment('y', 1);
			AssertTrunks(routesToInterdependentSections(after)).haveSharedSegment('y', 1);
			opened.destroy();
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

		it('reduces persisted documentary crossings while keeping the public canvas crossing-free', async () => {
			const opened = expectDocument(openDocument(twoByTwoInversionDocument));
			const measurements = layoutMeasurementsForCanvas(opened.measurementModel);
			const persistedBefore = opened.read();
			const before = await opened.createCanvasModel(measurements);

			await opened.addRelation({
				id: 'qualifying-source-b-to-target-a',
				from: 'source-b',
				to: 'target-a',
			});
			const after = await opened.createCanvasModel(measurements);
			const beforeBounds = new Map(before.nodes.map(({ id, bounds }) => [id, bounds]));
			const afterBounds = new Map(after.nodes.map(({ id, bounds }) => [id, bounds]));
			const documentaryScore = (document: typeof persistedBefore) => {
				const created = createGraph(document);
				if (!created.ok) throw new Error('Invalid documentary graph after relation edit');
				const graph = created.value;
				return scoreDedicatedCandidateRoutes(
					evaluateDedicatedLayout(prepareLayout(graph, topologicallyRank(graph)), measurements),
				);
			};
			const priorScore = documentaryScore(persistedBefore);
			const currentScore = documentaryScore(opened.read());
			expect(currentScore.strictCrossings).toBeLessThan(priorScore.strictCrossings);
			expect(currentScore.validatedBridges).toBeLessThan(priorScore.validatedBridges);
			const targetIds = ['target-a', 'target-b', 'target-c'];
			expect(orderedIds(after.nodes, targetIds)).toEqual(orderedIds(before.nodes, targetIds));

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
			AssertRoutes(before.relations).haveNoCrossing();
			AssertRoutes(after.relations).haveNoCrossing();
			const sourceIds = ['source-a', 'source-b'];
			expect(orderedIds(after.nodes, sourceIds)).toEqual(orderedIds(before.nodes, sourceIds));
			const sourceA = defined(afterBounds.get('source-a'));
			const sourceB = defined(afterBounds.get('source-b'));
			expect(sourceB.x - sourceA.x - sourceA.width).toBeGreaterThanOrEqual(36);
			AssertRoute(
				defined(after.relations.find(({ id }) => id === 'source-a-to-target-b')),
			).isStraightAlong('y');
			for (const id of sourceIds) {
				const previous = beforeBounds.get(id);
				const current = afterBounds.get(id);
				if (previous === undefined || current === undefined)
					throw new Error(`Missing source ${id}`);
				expect(current).toEqual(previous);
			}
		});
	});
});
