import { describe, expect, it } from 'vitest';

import {
	type CanvasEntityIndex,
	entityKey,
	EntityKind,
	entityRef,
} from '../../src/lib/canvas/canvas-entity';
import { CanvasSession } from '../../src/lib/session/canvas-session.svelte';

function entityIndex(...refs: ReturnType<typeof entityRef>[]): CanvasEntityIndex {
	return new Map(
		refs.map(
			(ref) =>
				[
					entityKey(ref.kind, ref.id),
					{ ref, bounds: undefined, navigationPoint: undefined },
				] as const,
		),
	);
}

describe('CanvasSession viewport intents', () => {
	it('derives percentage and updates zoom through named intents', () => {
		const session = new CanvasSession();
		expect(session.zoomPercentage).toBe(100);
		expect(session.zoomIn()).toBe(true);
		expect(session.zoom).toBe(1.1);
		expect(session.zoomPercentage).toBe(110);
		expect(session.zoomOut()).toBe(true);
		expect(session.zoom).toBe(1);
	});

	it('resets zoom and reports an unchanged reset as a no-op', () => {
		const session = new CanvasSession();
		expect(session.resetZoom()).toBe(false);
		session.zoomOut();
		expect(session.resetZoom()).toBe(true);
		expect(session.zoom).toBe(1);
	});

	it('stays bounded and reports boundary intents as no-ops', () => {
		const session = new CanvasSession();
		for (let index = 0; index < 20; index += 1) session.zoomOut();
		expect(session.zoom).toBe(0.5);
		expect(session.canZoomOut).toBe(false);
		expect(session.zoomOut()).toBe(false);

		for (let index = 0; index < 20; index += 1) session.zoomIn();
		expect(session.zoom).toBe(2);
		expect(session.canZoomIn).toBe(false);
		expect(session.zoomIn()).toBe(false);
	});
});

describe('CanvasSession selection intents', () => {
	const node = entityRef(EntityKind.Node, 'shared');
	const group = entityRef(EntityKind.Group, 'shared');
	const junction = entityRef(EntityKind.Junction, 'choice');
	const relation = entityRef(EntityKind.Relation, 'flow');

	it('selects one entity by canonical value identity and reports unchanged selection', () => {
		const session = new CanvasSession();

		expect(session.selectEntity(node)).toBe(true);
		expect(session.selectionCount).toBe(1);
		expect(session.selection.get(entityKey(EntityKind.Node, 'shared'))).toEqual(node);
		expect(session.isSelected(entityRef(EntityKind.Node, 'shared'))).toBe(true);
		expect(session.isSelected(group)).toBe(false);
		expect(session.announcement).toBe('node shared selected.');
		expect(session.selectEntity(entityRef(EntityKind.Node, 'shared'))).toBe(false);
	});

	it('replaces ordinary selection and supports additive mixed-kind selection', () => {
		const session = new CanvasSession();
		session.selectEntity(node);

		expect(session.addEntity(group)).toBe(true);
		expect(session.addEntity(junction)).toBe(true);
		expect(session.addEntity(group)).toBe(false);
		expect([...session.selection.keys()]).toEqual([
			entityKey(EntityKind.Node, 'shared'),
			entityKey(EntityKind.Group, 'shared'),
			entityKey(EntityKind.Junction, 'choice'),
		]);

		expect(session.selectEntity(relation)).toBe(true);
		expect([...session.selection.values()]).toEqual([relation]);
	});

	it('toggles keyboard-style membership without confusing overlapping IDs', () => {
		const session = new CanvasSession();

		expect(session.toggleEntity(node)).toBe(true);
		expect(session.toggleEntity(group)).toBe(true);
		expect(session.selectionCount).toBe(2);
		expect(session.toggleEntity(entityRef(EntityKind.Node, 'shared'))).toBe(true);
		expect(session.selectionCount).toBe(1);
		expect(session.isSelected(group)).toBe(true);
		expect(session.announcement).toBe('node shared removed from selection.');
	});

	it('clears selection from blank activation and Escape while preserving no-op state', () => {
		const session = new CanvasSession();

		expect(session.clearSelection()).toBe(false);
		expect(session.cancel()).toBe(false);
		session.selectEntity(node);
		expect(session.clearSelection()).toBe(true);
		expect(session.selectionCount).toBe(0);
		expect(session.announcement).toBe('Selection cleared.');
		session.selectEntity(group);
		expect(session.cancel()).toBe(true);
		expect(session.selectionCount).toBe(0);
	});

	it('preserves canonical selection across fresh accepted canvas indexes', () => {
		const session = new CanvasSession();
		session.selectEntity(node);
		session.addEntity(relation);

		expect(
			session.reconcile(
				entityIndex(entityRef(EntityKind.Node, 'shared'), entityRef(EntityKind.Relation, 'flow')),
			),
		).toBe(false);
		expect(session.selectionCount).toBe(2);
		expect(session.isSelected(entityRef(EntityKind.Node, 'shared'))).toBe(true);
	});

	it('prunes only missing selections and announces accepted-layout reconciliation', () => {
		const session = new CanvasSession();
		session.selectEntity(node);
		session.addEntity(group);
		session.addEntity(relation);

		expect(session.reconcile(entityIndex(group))).toBe(true);
		expect([...session.selection.values()]).toEqual([group]);
		expect(session.announcement).toBe('2 selected entities are no longer available.');
		expect(session.reconcile(entityIndex(group))).toBe(false);

		expect(session.reconcile(entityIndex())).toBe(true);
		expect(session.selectionCount).toBe(0);
		expect(session.announcement).toBe('1 selected entity is no longer available.');
	});

	it('keeps Select as the only active mode', () => {
		expect(new CanvasSession().selectModeActive).toBe(true);
	});
});
