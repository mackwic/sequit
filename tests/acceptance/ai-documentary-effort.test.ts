import { describe, expect, it } from 'vitest';

import { openDocument } from '../../src/lib/document/open-document';
import { weightedInversionScore } from '../../src/lib/layout/crossing-aware-order';
import { layoutMeasurementsForCanvas } from '../builders/layout-measurements';
import { aiDocumentaryEffortScenario } from '../scenarios/ai-documentary-effort';

const twoByTwoInversionDocument = `
persistenceFormat = 1

[document]
id = "two-by-two-inversion"
title = "Two by two inversion"

[layout]
direction = "top-to-bottom"
bias = "top"
endpointOrder = ["source-a", "source-b", "target-a", "target-b", "target-c", "successor"]

[natures.goal]
label = "Goal"
color = "#12c930"

[groups]

[nodes.source-a]
nature = "goal"
markdown = "Source A"

[nodes.source-b]
nature = "goal"
markdown = "Source B"

[nodes.target-a]
nature = "goal"
markdown = "Target A"

[nodes.target-b]
nature = "goal"
markdown = "Target B"

[nodes.target-c]
nature = "goal"
markdown = "Target C"

[nodes.successor]
nature = "goal"
markdown = "Successor"

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

			const opened = expectDocument(openDocument(source));
			const projection = expectDocument(opened.read());
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
			opened.close();
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

			opened.addNode({
				id: 'zz-added-first',
				natureId: 'goal',
				markdown: 'Added first',
			});
			opened.addNode({
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

			opened.addRelation({
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
					effectiveLinks: links,
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
						expect(previous.x === current.x || previous.y === current.y).toBe(true);
					}
					const fromBounds = bounds.get(relation.from);
					const toBounds = bounds.get(relation.to);
					const firstPoint = relation.points[0];
					const lastPoint = relation.points.at(-1);
					if (!fromBounds || !toBounds || !lastPoint) {
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
