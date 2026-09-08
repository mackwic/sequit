import { describe, expect, it, vi } from 'vitest';

import {
	type CanvasEntityIndex,
	entityKey,
	EntityKind,
	entityRef,
} from '../../src/lib/canvas/canvas-entity';
import {
	type DocumentCommandOutcome,
	DocumentCommandOutcomeKind,
} from '../../src/lib/document/document-command-gateway';
import {
	CanvasActivityKind,
	type CanvasDocumentCommandPort,
	CanvasEditAvailability,
	CanvasSession,
} from '../../src/lib/session/canvas-session.svelte';
import { validLogicDocument } from '../builders/logic-document';

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

function commandPort(
	implementation: CanvasDocumentCommandPort['replaceNodeMarkdown'],
): CanvasDocumentCommandPort {
	return { replaceNodeMarkdown: vi.fn(implementation) };
}

const editableNode = {
	id: 'shared',
	markdown: 'Original Markdown',
	bounds: { x: 12, y: 34, width: 220, height: 96 },
};

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

describe('CanvasSession Markdown editing intents', () => {
	const node = entityRef(EntityKind.Node, editableNode.id);

	function selectedSession(commands?: CanvasDocumentCommandPort) {
		const session = new CanvasSession(commands);
		session.selectEntity(node);
		return session;
	}

	function controlledCommand() {
		let complete!: (outcome: DocumentCommandOutcome) => void;
		const pending = new Promise<DocumentCommandOutcome>((resolve) => {
			complete = resolve;
		});
		return { commands: commandPort(() => pending), complete };
	}

	it('requires one selected node and freezes a value copy of accepted bounds', () => {
		const session = new CanvasSession();
		expect(session.contextualNodeKey).toBeUndefined();
		expect(session.updateDraft('Ignored without an editor')).toBe(false);
		expect(session.beginNodeMarkdownEdit(editableNode)).toBe(false);
		session.selectEntity(entityRef(EntityKind.Group, editableNode.id));
		expect(session.contextualNodeKey).toBeUndefined();
		expect(session.beginNodeMarkdownEdit(editableNode)).toBe(false);

		session.selectEntity(node);
		expect(session.contextualNodeKey).toBe(entityKey(EntityKind.Node, editableNode.id));
		expect(session.beginNodeMarkdownEdit(editableNode)).toBe(true);
		expect(session.beginNodeMarkdownEdit(editableNode)).toBe(false);
		expect(session.editing).toMatchObject({
			kind: CanvasActivityKind.Editing,
			target: entityKey(EntityKind.Node, editableNode.id),
			field: 'markdown',
			baseValue: editableNode.markdown,
			draft: editableNode.markdown,
			frozenBounds: editableNode.bounds,
			availability: CanvasEditAvailability.Available,
		});
		expect(session.editing?.frozenBounds).not.toBe(editableNode.bounds);
		expect(session.contextualNodeKey).toBeUndefined();
	});

	it('does not save without an active editor', async () => {
		await expect(new CanvasSession().saveDraft()).resolves.toBeUndefined();
	});

	it('reports the default unavailable command without discarding the draft', async () => {
		const session = selectedSession();
		session.beginNodeMarkdownEdit(editableNode);
		session.updateDraft('Locally preserved');

		await expect(session.saveDraft()).resolves.toMatchObject({
			kind: DocumentCommandOutcomeKind.Rejected,
			diagnostics: [{ code: 'node-markdown-unavailable' }],
		});
		expect(session.editing).toMatchObject({
			draft: 'Locally preserved',
			diagnostic: 'Node Markdown editing is unavailable: shared',
		});
	});

	it('updates a copyable draft and locks selection until editing exits', () => {
		const session = selectedSession();
		session.beginNodeMarkdownEdit(editableNode);

		expect(session.updateDraft('Edited Markdown')).toBe(true);
		expect(session.updateDraft('Edited Markdown')).toBe(false);
		expect(session.selectEntity(entityRef(EntityKind.Node, 'other'))).toBe(false);
		expect(session.addEntity(entityRef(EntityKind.Group, 'other'))).toBe(false);
		expect(session.toggleEntity(node)).toBe(false);
		expect(session.clearSelection()).toBe(false);
		expect(session.editing?.draft).toBe('Edited Markdown');
		expect([...session.selection.values()]).toEqual([node]);
	});

	it('cancels editing before selection and requests immediate keyed focus restoration', () => {
		const session = selectedSession();
		session.beginNodeMarkdownEdit(editableNode);
		session.updateDraft('Discarded draft');

		expect(session.cancel()).toBe(true);
		expect(session.activity.kind).toBe(CanvasActivityKind.Idle);
		expect(session.selectionCount).toBe(1);
		expect(session.focusRestorationTarget).toBe(entityKey(EntityKind.Node, editableNode.id));
		expect(session.completeFocusRestoration(entityKey(EntityKind.Node, 'other'))).toBe(false);
		expect(session.completeFocusRestoration(entityKey(EntityKind.Node, editableNode.id))).toBe(
			true,
		);
		expect(session.focusRestorationTarget).toBeUndefined();
		expect(session.cancel()).toBe(true);
		expect(session.selectionCount).toBe(0);
	});

	it('keeps editing pending until acceptance and waits for a newer accepted layout', async () => {
		const controlled = controlledCommand();
		const session = selectedSession(controlled.commands);
		session.beginNodeMarkdownEdit(editableNode);
		session.updateDraft('Accepted Markdown');

		const pending = session.saveDraft();
		expect(session.editing?.saving).toBe(true);
		expect(session.updateDraft('Too late')).toBe(false);
		expect(await session.saveDraft()).toBeUndefined();
		controlled.complete({
			kind: DocumentCommandOutcomeKind.Accepted,
			document: validLogicDocument(),
		});
		await expect(pending).resolves.toMatchObject({ kind: DocumentCommandOutcomeKind.Accepted });

		expect(controlled.commands.replaceNodeMarkdown).toHaveBeenCalledWith(
			'shared',
			'Accepted Markdown',
		);
		expect(session.activity.kind).toBe(CanvasActivityKind.Idle);
		expect(session.awaitingAcceptedLayout).toBe(true);
		expect(session.focusRestorationTarget).toBeUndefined();
		expect(session.reconcile(entityIndex(node))).toBe(true);
		expect(session.awaitingAcceptedLayout).toBe(false);
		expect(session.focusRestorationTarget).toBe(entityKey(EntityKind.Node, editableNode.id));
	});

	it('recognizes acceptance after layout wins the acknowledgement race', async () => {
		const controlled = controlledCommand();
		const session = selectedSession(controlled.commands);
		session.beginNodeMarkdownEdit(editableNode);
		const pending = session.saveDraft();
		session.reconcile(entityIndex(node));

		controlled.complete({
			kind: DocumentCommandOutcomeKind.Accepted,
			document: validLogicDocument(),
		});
		await pending;

		expect(session.awaitingAcceptedLayout).toBe(false);
		expect(session.focusRestorationTarget).toBe(entityKey(EntityKind.Node, editableNode.id));
	});

	it.each([
		{
			name: 'rejection',
			outcome: {
				kind: DocumentCommandOutcomeKind.Rejected,
				diagnostics: [{ code: 'policy', message: 'Markdown rejected', path: ['nodes'] }],
			} as const,
		},
		{
			name: 'rollback',
			outcome: {
				kind: DocumentCommandOutcomeKind.RolledBack,
				diagnostics: [{ code: 'rollback', message: 'Markdown rolled back', path: ['nodes'] }],
			} as const,
		},
		{
			name: 'failure',
			outcome: {
				kind: DocumentCommandOutcomeKind.Failed,
				error: new Error('Storage failed'),
			} as const,
		},
		{
			name: 'non-Error failure',
			outcome: { kind: DocumentCommandOutcomeKind.Failed, error: 'Protocol failed' } as const,
		},
	])('preserves draft, selection, and activity after $name', async ({ outcome }) => {
		const session = selectedSession(commandPort(() => Promise.resolve(outcome)));
		session.beginNodeMarkdownEdit(editableNode);
		session.updateDraft('Preserved draft');

		await session.saveDraft();

		expect(session.editing).toMatchObject({ draft: 'Preserved draft', saving: false });
		expect(session.editing?.diagnostic).toBeTruthy();
		expect(session.selectionCount).toBe(1);
		expect(session.announcement).toContain('Could not save node shared');
	});

	it('normalizes a rejected command promise without losing the draft', async () => {
		const session = selectedSession(
			commandPort(() => Promise.reject(new Error('Gateway disconnected'))),
		);
		session.beginNodeMarkdownEdit(editableNode);
		session.updateDraft('Offline draft');

		expect(await session.saveDraft()).toEqual({
			kind: DocumentCommandOutcomeKind.Failed,
			error: new Error('Gateway disconnected'),
		});
		expect(session.editing?.draft).toBe('Offline draft');
		expect(session.editing?.diagnostic).toBe('Gateway disconnected');
	});

	it('preserves an orphaned draft and selected key when the target is removed', async () => {
		const commands = commandPort(() =>
			Promise.resolve({
				kind: DocumentCommandOutcomeKind.Accepted,
				document: validLogicDocument(),
			}),
		);
		const session = selectedSession(commands);
		session.beginNodeMarkdownEdit(editableNode);
		session.updateDraft('Copyable orphaned draft');

		expect(session.reconcile(entityIndex())).toBe(true);
		expect(session.editing).toMatchObject({
			draft: 'Copyable orphaned draft',
			availability: CanvasEditAvailability.Deleted,
		});
		expect(session.selectionCount).toBe(1);
		expect(await session.saveDraft()).toBeUndefined();
		expect(commands.replaceNodeMarkdown).not.toHaveBeenCalled();
		expect(session.cancel()).toBe(true);
	});

	it('marks a save/deletion race as deleted and keeps the attempted draft', async () => {
		const controlled = controlledCommand();
		const session = selectedSession(controlled.commands);
		session.beginNodeMarkdownEdit(editableNode);
		session.updateDraft('Racing draft');
		const pending = session.saveDraft();
		session.reconcile(entityIndex());
		controlled.complete({
			kind: DocumentCommandOutcomeKind.Rejected,
			diagnostics: [
				{
					code: 'node-not-found',
					message: 'Node no longer exists: shared',
					path: ['nodes', 'shared'],
				},
			],
		});

		await pending;
		expect(session.editing).toMatchObject({
			draft: 'Racing draft',
			availability: CanvasEditAvailability.Deleted,
			diagnostic: 'Node no longer exists: shared',
		});
		expect(session.selectionCount).toBe(1);
	});

	it('does not let delayed acceptance discard a draft orphaned by reconciliation', async () => {
		const controlled = controlledCommand();
		const session = selectedSession(controlled.commands);
		session.beginNodeMarkdownEdit(editableNode);
		session.updateDraft('Accepted but orphaned draft');
		const pending = session.saveDraft();
		session.reconcile(entityIndex());
		controlled.complete({
			kind: DocumentCommandOutcomeKind.Accepted,
			document: validLogicDocument(),
		});

		await pending;
		expect(session.editing).toMatchObject({
			draft: 'Accepted but orphaned draft',
			availability: CanvasEditAvailability.Deleted,
			saving: false,
			saveId: undefined,
		});
		expect(session.selectionCount).toBe(1);
		expect(session.awaitingAcceptedLayout).toBe(false);
	});

	it('closing a submitted edit preserves the pending command and prevents late UI overwrite', async () => {
		const controlled = controlledCommand();
		const session = selectedSession(controlled.commands);
		session.beginNodeMarkdownEdit(editableNode);
		const pending = session.saveDraft();
		session.cancel();
		expect(session.announcement).toContain('Submitted change remains pending');
		controlled.complete({
			kind: DocumentCommandOutcomeKind.Rejected,
			diagnostics: [{ code: 'late', message: 'Late rejection', path: [] }],
		});

		await pending;
		expect(session.activity.kind).toBe(CanvasActivityKind.Idle);
		expect(session.focusRestorationTarget).toBe(entityKey(EntityKind.Node, editableNode.id));
	});

	it('drops a pending focus request when its keyed target is absent from accepted layout', () => {
		const session = selectedSession();
		session.beginNodeMarkdownEdit(editableNode);
		session.cancel();

		expect(session.reconcile(entityIndex())).toBe(true);
		expect(session.focusRestorationTarget).toBeUndefined();
		expect(session.completeFocusRestoration(entityKey(EntityKind.Node, editableNode.id))).toBe(
			false,
		);
	});
});
