import { afterEach, describe, expect, it, vi } from 'vitest';

import { DocumentProjection } from '../../../../src/app/web/projection/document-projection';
import * as layout from '../../../../src/app/web/projection/layout-graph';
import { createSharedCanvasProjection } from '../../../../src/app/web/projection/open-document';
import { renderRelationPaths } from '../../../../src/app/web/ui/canvas/render-relations';
import {
	defined,
	GroupState,
	LayoutBias,
	LayoutDirection,
} from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import { layoutMeasurementsForCanvas } from '../../../support/builders/layout-measurements';
import {
	CollaborativeFixture,
	collaborativeFixture,
} from '../../../support/fixtures/collaborative-document';

afterEach(() => vi.restoreAllMocks());

describe('live document projection', () => {
	it('keeps a valid source expanded when collapsing its group would create a false cycle', async () => {
		const source = collaborativeFixture(CollaborativeFixture.OpenGroup, 'room');
		const first = defined(source.nodes[0]);
		const document = {
			...source,
			groups: source.groups.map((group) => ({ ...group, state: GroupState.Closed })),
			nodes: [
				...source.nodes,
				{
					kind: first.kind,
					id: 'C',
					natureId: 'N',
					markdown: 'Outside',
					layoutOrder: orderKey('a3'),
				},
			],
			relations: [
				{ id: 'one', from: 'B', to: 'C' },
				{ id: 'two', from: 'C', to: 'A' },
			],
		};
		const projection = createSharedCanvasProjection(document);
		expect(projection.warning).toContain('dépliée');
		expect(projection.visible.hiddenEndpointIds.size).toBe(0);
		expect(
			(await projection.createCanvasModel(layoutMeasurementsForCanvas(projection.measurementModel)))
				.nodes,
		).toHaveLength(3);
		projection.update(source);
		expect(projection.warning).toBeUndefined();
	});
	it('reuses geometry for text/style changes of equal measured size and keeps each result immutable', async () => {
		const calculate = vi.spyOn(layout, 'layoutGraph');
		const source = collaborativeFixture(CollaborativeFixture.LinkedBoxes, 'room');
		const projection = new DocumentProjection(source);
		const sizes = layoutMeasurementsForCanvas(projection.measurementModel);
		const before = await projection.createCanvasModel(sizes);
		expect(
			projection.update({
				...source,
				nodes: source.nodes.map((node) => ({ ...node, markdown: 'Changed', color: '#abcdef' })),
			}),
		).toBe(true);
		const after = await projection.createCanvasModel(sizes);
		expect(after.nodes[0]?.markdown).toBe('Changed');
		expect(after.nodes[0]?.color).toBe('#abcdef');
		expect(before.nodes[0]?.markdown).toBe('Alpha');
		expect(after.nodes.map(({ bounds }) => bounds)).toEqual(
			before.nodes.map(({ bounds }) => bounds),
		);
		expect(after.relations).toBe(before.relations);
		expect(renderRelationPaths(after.relations)).toEqual(renderRelationPaths(before.relations));
		expect(calculate).toHaveBeenCalledTimes(1);
	});

	it('retains relation identity through shared text snapshots with equivalent provenance', async () => {
		const source = collaborativeFixture(CollaborativeFixture.LinkedBoxes, 'room');
		const projection = createSharedCanvasProjection(source);
		const sizes = layoutMeasurementsForCanvas(projection.measurementModel);
		const before = await projection.createCanvasModel(sizes);
		projection.update({
			...source,
			nodes: source.nodes.map((node) => ({ ...node, markdown: 'New text', color: '#abcdef' })),
		});
		const after = await projection.createCanvasModel(sizes);
		expect(after.nodes[0]).toMatchObject({ markdown: 'New text', color: '#abcdef' });
		expect(after.relations).toBe(before.relations);
		expect(after.relations[0]?.sourceRelationIds).toEqual(['R']);
	});

	it('refreshes aggregate source relations and editing capabilities without recalculating geometry', async () => {
		const calculate = vi.spyOn(layout, 'layoutGraph');
		const source = collaborativeFixture(CollaborativeFixture.OpenGroup, 'room');
		const outside = defined(collaborativeFixture(CollaborativeFixture.TwoBoxes, 'room').nodes[0]);
		const document = {
			...source,
			groups: source.groups.map((group) => ({ ...group, state: GroupState.Closed })),
			nodes: [...source.nodes, { ...outside, id: 'C', layoutOrder: orderKey('a3') }],
			relations: [
				{ id: 'R1', from: 'A', to: 'C' },
				{ id: 'R2', from: 'B', to: 'C' },
			],
		};
		const projection = createSharedCanvasProjection(document);
		const sizes = layoutMeasurementsForCanvas(projection.measurementModel);
		const before = await projection.createCanvasModel(sizes);
		const changedSources = {
			...document,
			relations: document.relations.map((relation) => {
				if (relation.id === 'R2') return { ...relation, id: 'R3' };
				return relation;
			}),
		};
		projection.update(changedSources);
		const changed = await projection.createCanvasModel(sizes);
		expect(changed.relations).not.toBe(before.relations);
		expect(changed.relations[0]?.points).toBe(before.relations[0]?.points);
		expect(changed.relations[0]?.sourceRelationIds).toEqual(['R1', 'R3']);
		expect(before.relations[0]?.sourceRelationIds).toEqual(['R1', 'R2']);
		projection.update({
			...changedSources,
			relations: [...changedSources.relations, { id: 'R4', from: 'A', to: 'C' }],
		});
		const threeSources = await projection.createCanvasModel(sizes);
		expect(threeSources.relations).not.toBe(changed.relations);
		expect(threeSources.relations[0]?.points).toBe(changed.relations[0]?.points);
		expect(threeSources.relations[0]).toMatchObject({
			sourceRelationIds: ['R1', 'R3', 'R4'],
			canChangeFrom: false,
			canChangeTo: false,
		});
		projection.update({
			...changedSources,
			relations: changedSources.relations.filter(({ id }) => id === 'R1'),
		});
		const single = await projection.createCanvasModel(sizes);
		expect(single.relations).not.toBe(changed.relations);
		expect(single.relations[0]).toMatchObject({
			sourceRelationIds: ['R1'],
			canChangeFrom: false,
			canChangeTo: true,
		});
		expect(changed.relations[0]?.canChangeTo).toBe(false);
		projection.update({
			...document,
			relations: [{ id: 'R1', from: 'G', to: 'C' }],
		});
		const direct = await projection.createCanvasModel(sizes);
		expect(direct.relations).not.toBe(single.relations);
		expect(direct.relations[0]?.points).toBe(single.relations[0]?.points);
		expect(direct.relations[0]).toMatchObject({
			sourceRelationIds: ['R1'],
			canChangeFrom: true,
			canChangeTo: true,
		});
		expect(single.relations[0]?.canChangeFrom).toBe(false);
		expect(calculate).toHaveBeenCalledTimes(1);
	});

	it('invalidates geometry for topology, direction and measured-size changes', async () => {
		const calculate = vi.spyOn(layout, 'layoutGraph');
		const source = collaborativeFixture(CollaborativeFixture.TwoBoxes, 'room');
		const projection = new DocumentProjection(source);
		const sizes = layoutMeasurementsForCanvas(projection.measurementModel);
		await projection.createCanvasModel(sizes);
		const linked = { ...source, relations: [{ id: 'link', from: 'B', to: 'A' }] };
		expect(projection.update(linked)).toBe(true);
		const connected = await projection.createCanvasModel(sizes);
		expect(connected.relations).toHaveLength(1);
		projection.update({
			...linked,
			layout: { direction: LayoutDirection.LeftToRight, bias: LayoutBias.Left },
		});
		const rotated = await projection.createCanvasModel(sizes);
		expect(rotated.direction).toBe(LayoutDirection.LeftToRight);
		expect(rotated.relations).not.toBe(connected.relations);
		const larger = { ...sizes, nodes: new Map(sizes.nodes) };
		larger.nodes.set('A', { width: 400, height: 200 });
		const resized = await projection.createCanvasModel(larger);
		expect(resized.nodes.find(({ id }) => id === 'A')?.bounds.width).toBe(400);
		expect(resized.relations).not.toBe(rotated.relations);
		expect(renderRelationPaths(resized.relations)).not.toEqual(
			renderRelationPaths(rotated.relations),
		);
		expect(calculate).toHaveBeenCalledTimes(4);
	});

	it('keeps relation caches local to each opened document', async () => {
		const source = collaborativeFixture(CollaborativeFixture.LinkedBoxes, 'room');
		const first = new DocumentProjection(source);
		const second = new DocumentProjection(source);
		const sizes = layoutMeasurementsForCanvas(first.measurementModel);
		const original = await first.createCanvasModel(sizes);
		const independent = await second.createCanvasModel(sizes);
		expect(independent.relations).toEqual(original.relations);
		expect(independent.relations).not.toBe(original.relations);
		expect((await first.createCanvasModel(sizes)).relations).toBe(original.relations);
	});

	it('publishes visible changes only, retaining geometry and the current scene on invalid snapshots', () => {
		const source = collaborativeFixture(CollaborativeFixture.TwoBoxes, 'room');
		const projection = createSharedCanvasProjection(source);
		const measurement = projection.measurementModel;
		const changed = vi.fn();
		projection.subscribe(() => {
			throw new Error('Broken view');
		});
		const stop = projection.subscribe(changed);
		projection.update({
			...source,
			title: 'New title',
			nodes: source.nodes.map((node) => ({ ...node, description: '# Details' })),
		});
		expect(projection.measurementModel).toBe(measurement);
		expect(changed).not.toHaveBeenCalled();
		expect(() => {
			projection.update({ ...source, relations: [{ id: 'bad', from: 'A', to: 'missing' }] });
		}).toThrow();
		expect(projection.measurementModel).toBe(measurement);
		projection.update({
			...source,
			nodes: source.nodes.map((node) => ({ ...node, markdown: 'Visible' })),
		});
		expect(changed).toHaveBeenCalledOnce();
		stop();
		projection.update(source);
		expect(changed).toHaveBeenCalledOnce();
	});

	it('captures the requested snapshot even when a newer update arrives before layout resolves', async () => {
		const source = collaborativeFixture(CollaborativeFixture.TwoBoxes, 'room');
		const projection = new DocumentProjection(source);
		const sizes = layoutMeasurementsForCanvas(projection.measurementModel);
		const pending = projection.createCanvasModel(sizes);
		projection.update({
			...source,
			nodes: source.nodes.map((node) => ({ ...node, markdown: 'Later' })),
		});
		expect((await pending).nodes[0]?.markdown).toBe('Alpha');
		expect((await projection.createCanvasModel(sizes)).nodes[0]?.markdown).toBe('Later');
	});

	it('retries a failed calculation instead of retaining a rejected promise', async () => {
		const source = collaborativeFixture(CollaborativeFixture.TwoBoxes, 'room');
		const projection = new DocumentProjection(source);
		const sizes = layoutMeasurementsForCanvas(projection.measurementModel);
		vi.spyOn(layout, 'layoutGraph').mockRejectedValueOnce(new Error('Temporary layout failure'));
		await expect(projection.createCanvasModel(sizes)).rejects.toThrow('Temporary');
		await expect(projection.createCanvasModel(sizes)).resolves.toMatchObject({
			nodes: [{ id: 'A' }, { id: 'B' }],
		});
	});

	it('keeps a newer geometry and its relations cached when an earlier calculation fails late', async () => {
		const source = collaborativeFixture(CollaborativeFixture.LinkedBoxes, 'room');
		const projection = new DocumentProjection(source);
		const sizes = layoutMeasurementsForCanvas(projection.measurementModel);
		const delayed = Promise.withResolvers<layout.LayoutResult>();
		const calculate = vi.spyOn(layout, 'layoutGraph').mockReturnValueOnce(delayed.promise);
		const obsolete = projection.createCanvasModel(sizes);
		const larger = { ...sizes, nodes: new Map(sizes.nodes) };
		larger.nodes.set('A', { width: 400, height: 200 });
		const current = await projection.createCanvasModel(larger);
		const rejection = expect(obsolete).rejects.toThrow('Obsolete failure');
		delayed.reject(new Error('Obsolete failure'));
		await rejection;
		const retained = await projection.createCanvasModel(larger);
		expect(retained.nodes.find(({ id }) => id === 'A')?.bounds.width).toBe(400);
		expect(retained.relations).toBe(current.relations);
		expect(calculate).toHaveBeenCalledTimes(2);
	});
});
