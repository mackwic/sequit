import { describe, expect, it, vi } from 'vitest';

import {
	type CanvasEntityIndex,
	entityKey,
	EntityKind,
	entityRef,
} from '../../../../../src/app/web/ui/canvas/canvas-entity';
import {
	CanvasActivityKind,
	type CanvasDocumentCommandPort,
	CanvasEditAvailability,
	CanvasEditPresentation,
	CanvasSession,
} from '../../../../../src/app/web/ui/session/canvas-session.svelte';
import { SessionNoticeCode } from '../../../../../src/lib/infrastructure/collaboration/session-reasons';
import {
	type DocumentCommandOutcome,
	DocumentCommandOutcomeKind,
} from '../../../../../src/lib/infrastructure/document/document-command-contracts';
import type { NodeFields } from '../../../../../src/lib/infrastructure/document/node-fields';
import { validLogicDocument } from '../../../../support/builders/logic-document';

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
	implementation: CanvasDocumentCommandPort['saveNode'] = () =>
		Promise.resolve({
			kind: DocumentCommandOutcomeKind.Accepted,
			document: validLogicDocument(),
		}),
): CanvasDocumentCommandPort {
	return { readNode: vi.fn(() => fields), saveNode: vi.fn(implementation) };
}

const fields: NodeFields = {
	natureId: 'goal',
	markdown: 'Original Markdown',
	description: '',
	color: '',
	icon: '',
	laneId: '',
};

const editableNode = {
	id: 'shared',
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
		for (let index = 0; index < 30; index += 1) session.zoomOut();
		expect(session.zoom).toBe(0.1);
		expect(session.canZoomOut).toBe(false);
		expect(session.zoomOut()).toBe(false);

		for (let index = 0; index < 30; index += 1) session.zoomIn();
		expect(session.zoom).toBe(2.5);
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

	it('exposes exactly one selected endpoint for relative node creation', () => {
		const session = new CanvasSession();
		expect(session.relativeNodeCreationTarget).toBeUndefined();
		session.selectEntity(group);
		expect(session.relativeNodeCreationTarget).toEqual(group);
		session.addEntity(node);
		expect(session.relativeNodeCreationTarget).toBeUndefined();
		session.selectEntity(relation);
		expect(session.relativeNodeCreationTarget).toBeUndefined();
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
});

describe('CanvasSession box editing intents', () => {
	const node = entityRef(EntityKind.Node, editableNode.id);

	function selectedSession(commands: CanvasDocumentCommandPort = commandPort()) {
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

	it('begins only for the sole selected node when the document can read it', () => {
		const session = new CanvasSession(commandPort());
		expect(session.beginNodeEdit(editableNode)).toBe(false);
		session.selectEntity(node);
		expect(session.beginNodeEdit(editableNode)).toBe(true);
		expect(session.beginNodeEdit(editableNode)).toBe(false);
		expect(session.editing).toMatchObject({
			kind: CanvasActivityKind.Editing,
			target: entityKey(EntityKind.Node, editableNode.id),
			base: fields,
			draft: fields,
			frozenBounds: editableNode.bounds,
			availability: CanvasEditAvailability.Available,
		});
		expect(session.editing?.frozenBounds).not.toBe(editableNode.bounds);
	});

	it('does not begin for a non-node, multiple selection, or missing document node', () => {
		const groupSession = new CanvasSession(commandPort());
		groupSession.selectEntity(entityRef(EntityKind.Group, editableNode.id));
		expect(groupSession.beginNodeEdit(editableNode)).toBe(false);

		const multipleSession = selectedSession();
		multipleSession.addEntity(entityRef(EntityKind.Node, 'other'));
		expect(multipleSession.beginNodeEdit(editableNode)).toBe(false);

		const missingSession = new CanvasSession({
			readNode: vi.fn(() => undefined),
			saveNode: vi.fn(),
		});
		missingSession.selectEntity(node);
		expect(missingSession.beginNodeEdit(editableNode)).toBe(false);
	});

	it('does not save without an active editor', async () => {
		await expect(new CanvasSession().saveDraft()).resolves.toBeUndefined();
	});

	it('updates changed fields only and locks selection until editing exits', () => {
		const session = selectedSession();
		session.beginNodeEdit(editableNode);

		expect(session.updateDraft({ markdown: 'Edited Markdown' })).toBe(true);
		expect(session.updateDraft({ markdown: 'Edited Markdown' })).toBe(false);
		expect(session.updateDraft({ color: '' })).toBe(false);
		expect(session.selectEntity(entityRef(EntityKind.Node, 'other'))).toBe(false);
		expect(session.addEntity(entityRef(EntityKind.Group, 'other'))).toBe(false);
		expect(session.toggleEntity(node)).toBe(false);
		expect(session.clearSelection()).toBe(false);
		expect(session.editing?.draft).toEqual({ ...fields, markdown: 'Edited Markdown' });
		expect([...session.selection.values()]).toEqual([node]);
	});

	it('cancels editing before selection and requests keyed focus restoration', () => {
		const session = selectedSession();
		session.beginNodeEdit(editableNode);
		session.updateDraft({ markdown: 'Discarded draft' });

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

	it('saves the base and draft, then waits for the accepted layout before restoring focus', async () => {
		const controlled = controlledCommand();
		const session = selectedSession(controlled.commands);
		session.beginNodeEdit(editableNode);
		const draft = { ...fields, markdown: 'Accepted Markdown' };
		session.updateDraft({ markdown: draft.markdown });

		const pending = session.saveDraft();
		expect(session.editing?.saving).toBe(true);
		expect(session.updateDraft({ markdown: 'Too late' })).toBe(false);
		expect(await session.saveDraft()).toBeUndefined();
		controlled.complete({
			kind: DocumentCommandOutcomeKind.Accepted,
			document: validLogicDocument(),
		});
		await expect(pending).resolves.toMatchObject({ kind: DocumentCommandOutcomeKind.Accepted });

		expect(controlled.commands.saveNode).toHaveBeenCalledWith('shared', fields, draft);
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
		session.beginNodeEdit(editableNode);
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
				diagnostics: [{ code: 'policy', message: 'Node rejected', path: ['nodes'] }],
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
		session.beginNodeEdit(editableNode);
		session.updateDraft({ markdown: 'Preserved draft' });

		await session.saveDraft();

		expect(session.editing).toMatchObject({
			draft: { ...fields, markdown: 'Preserved draft' },
			saving: false,
		});
		expect(session.editing?.diagnostic).toBeTruthy();
		expect(session.selectionCount).toBe(1);
		expect(session.announcement).toContain('Could not save node shared');
	});

	it('normalizes a rejected command promise without losing the draft', async () => {
		const session = selectedSession(
			commandPort(() => Promise.reject(new Error('Gateway disconnected'))),
		);
		session.beginNodeEdit(editableNode);
		session.updateDraft({ markdown: 'Offline draft' });

		expect(await session.saveDraft()).toEqual({
			kind: DocumentCommandOutcomeKind.Failed,
			error: new Error('Gateway disconnected'),
		});
		expect(session.editing?.draft).toEqual({ ...fields, markdown: 'Offline draft' });
		expect(session.editing?.diagnostic).toBe('Une erreur est survenue : Gateway disconnected');
	});

	it('preserves an orphaned draft and selected key when the target is removed', async () => {
		const commands = commandPort();
		const session = selectedSession(commands);
		session.beginNodeEdit(editableNode);
		session.updateDraft({ markdown: 'Copyable orphaned draft' });

		expect(session.reconcile(entityIndex())).toBe(true);
		expect(session.editing).toMatchObject({
			draft: { ...fields, markdown: 'Copyable orphaned draft' },
			availability: CanvasEditAvailability.Deleted,
		});
		expect(session.selectionCount).toBe(1);
		expect(await session.saveDraft()).toBeUndefined();
		expect(commands.saveNode).not.toHaveBeenCalled();
		expect(session.cancel()).toBe(true);
	});

	it('ends a box typed in place when the box goes, since nothing is left to type in', () => {
		const session = selectedSession(commandPort());
		session.beginNodeEdit(editableNode, CanvasEditPresentation.InPlace);
		session.updateDraft({ markdown: 'Typed in a vanished box' });

		expect(session.reconcile(entityIndex())).toBe(true);
		expect(session.activity.kind).toBe(CanvasActivityKind.Idle);
		expect(session.selectionCount).toBe(0);
	});

	it('leaves the focus where the author went when a box typed in place is saved on leaving', async () => {
		const session = selectedSession(commandPort());
		session.beginNodeEdit(editableNode, CanvasEditPresentation.InPlace);
		session.updateDraft({ markdown: 'Saved on leaving' });

		expect(await session.saveDraft({ restoreFocus: false })).toMatchObject({
			kind: DocumentCommandOutcomeKind.Accepted,
		});
		expect(session.activity.kind).toBe(CanvasActivityKind.Idle);
		expect(session.awaitingAcceptedLayout).toBe(false);
		expect(session.reconcile(entityIndex(entityRef(EntityKind.Node, editableNode.id)))).toBe(false);
		expect(session.focusRestorationTarget).toBeUndefined();
	});

	it('marks a save/deletion race as deleted and keeps the attempted draft', async () => {
		const controlled = controlledCommand();
		const session = selectedSession(controlled.commands);
		session.beginNodeEdit(editableNode);
		session.updateDraft({ markdown: 'Racing draft' });
		const pending = session.saveDraft();
		session.reconcile(entityIndex());
		controlled.complete({
			kind: DocumentCommandOutcomeKind.Rejected,
			diagnostics: [
				{
					code: 'node-not-found',
					message: 'Node no longer exists: shared',
					path: ['nodes', 'shared'],
					reason: { code: SessionNoticeCode.NodeNotFound, nodeId: 'shared' },
				},
			],
		});

		await pending;
		expect(session.editing).toMatchObject({
			draft: { ...fields, markdown: 'Racing draft' },
			availability: CanvasEditAvailability.Deleted,
			diagnostic: 'Node no longer exists: shared',
		});
		expect(session.selectionCount).toBe(1);
	});

	it('does not let delayed acceptance discard a draft orphaned by reconciliation', async () => {
		const controlled = controlledCommand();
		const session = selectedSession(controlled.commands);
		session.beginNodeEdit(editableNode);
		session.updateDraft({ markdown: 'Accepted but orphaned draft' });
		const pending = session.saveDraft();
		session.reconcile(entityIndex());
		controlled.complete({
			kind: DocumentCommandOutcomeKind.Accepted,
			document: validLogicDocument(),
		});

		await pending;
		expect(session.editing).toMatchObject({
			draft: { ...fields, markdown: 'Accepted but orphaned draft' },
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
		session.beginNodeEdit(editableNode);
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
		session.beginNodeEdit(editableNode);
		session.cancel();

		expect(session.reconcile(entityIndex())).toBe(true);
		expect(session.focusRestorationTarget).toBeUndefined();
		expect(session.completeFocusRestoration(entityKey(EntityKind.Node, editableNode.id))).toBe(
			false,
		);
	});
});
