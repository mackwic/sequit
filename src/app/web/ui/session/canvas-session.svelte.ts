import { SvelteMap } from 'svelte/reactivity';

import type { Bounds } from '../../../../lib/core/layout/layout-types';
import {
	DocumentCommandDiagnosticCode,
	type DocumentCommandOutcome,
	DocumentCommandOutcomeKind,
} from '../../../../lib/infrastructure/document/document-command-contracts';
import {
	type CanvasEntityIndex,
	type EntityKey,
	entityKey,
	EntityKind,
	type EntityRef,
} from '../canvas/canvas-entity';
import {
	DEFAULT_CANVAS_ZOOM,
	MAX_CANVAS_ZOOM,
	MIN_CANVAS_ZOOM,
	stepCanvasZoom,
} from '../canvas/canvas-viewport';
import {
	type CanvasActivity,
	CanvasActivityKind,
	canvasCommandDiagnostic,
	type CanvasDocumentCommandPort,
	CanvasEditableField,
	CanvasEditAvailability,
	type EditingCanvasActivity,
	idleCanvasActivity,
	type NodeEditDraft,
	PendingNodeCreation,
	type PendingNodeEdit,
	pendingNodeEditActivity,
	queuePendingNodeEdit,
	unavailableCanvasCommands,
} from './canvas-edit-activity';

export {
	type CanvasActivity,
	CanvasActivityKind,
	type CanvasDocumentCommandPort,
	CanvasEditAvailability,
	type EditingCanvasActivity,
} from './canvas-edit-activity';

interface CanvasFocusRequest {
	readonly target: EntityKey;
	readonly afterLayoutRevision: number;
	readonly ready: boolean;
}

const NODE_NOT_FOUND_CODE: string = DocumentCommandDiagnosticCode.NodeNotFound;

export class CanvasSession {
	zoom = $state(DEFAULT_CANVAS_ZOOM);
	private readonly selectedEntities = new SvelteMap<EntityKey, EntityRef>();
	activity = $state<CanvasActivity>(idleCanvasActivity());
	announcement = $state('');
	private focusRequest = $state<CanvasFocusRequest>();
	private pendingNodeEdit = $state<PendingNodeEdit>();
	private readonly pendingNodeCreation = new PendingNodeCreation();
	private layoutRevision = 0;
	private nextSaveId = 1;
	readonly selectModeActive = true;

	constructor(private readonly commands: CanvasDocumentCommandPort = unavailableCanvasCommands) {}

	get selection(): ReadonlyMap<EntityKey, EntityRef> {
		return this.selectedEntities;
	}

	get selectionCount(): number {
		return this.selectedEntities.size;
	}

	get zoomPercentage(): number {
		return Math.round(this.zoom * 100);
	}

	get canZoomIn(): boolean {
		return this.zoom < MAX_CANVAS_ZOOM;
	}

	get canZoomOut(): boolean {
		return this.zoom > MIN_CANVAS_ZOOM;
	}

	get editing(): EditingCanvasActivity | undefined {
		if (this.activity.kind === CanvasActivityKind.Editing) return this.activity;
		return undefined;
	}

	get contextualEntity(): EntityRef | undefined {
		if (this.activity.kind !== CanvasActivityKind.Idle || this.selectedEntities.size !== 1) {
			return undefined;
		}
		return [...this.selectedEntities.values()][0];
	}

	get relativeNodeCreationTarget(): EntityRef | undefined {
		if (this.selectedEntities.size !== 1) return undefined;
		const selected = [...this.selectedEntities.values()][0];
		if (selected?.kind === EntityKind.Relation) return undefined;
		return selected;
	}

	get focusRestorationTarget(): EntityKey | undefined {
		if (this.focusRequest?.ready !== true) return undefined;
		return this.focusRequest.target;
	}

	get awaitingAcceptedLayout(): boolean {
		const waitingForFocus = this.focusRequest !== undefined && !this.focusRequest.ready;
		return waitingForFocus || this.pendingNodeEdit !== undefined;
	}

	zoomIn(): boolean {
		return this.updateZoom(stepCanvasZoom(this.zoom, 1));
	}

	zoomOut(): boolean {
		return this.updateZoom(stepCanvasZoom(this.zoom, -1));
	}

	resetZoom(): boolean {
		return this.updateZoom(DEFAULT_CANVAS_ZOOM);
	}

	isSelected(ref: EntityRef): boolean {
		return this.selectedEntities.has(entityKey(ref.kind, ref.id));
	}

	selectEntity(ref: EntityRef): boolean {
		if (this.activity.kind === CanvasActivityKind.Editing) return false;
		const key = entityKey(ref.kind, ref.id);
		if (this.selectedEntities.size === 1 && this.selectedEntities.has(key)) return false;
		this.selectedEntities.clear();
		this.selectedEntities.set(key, ref);
		this.announcement = `${ref.kind} ${ref.id} selected.`;
		return true;
	}

	addEntity(ref: EntityRef): boolean {
		if (this.activity.kind === CanvasActivityKind.Editing) return false;
		const key = entityKey(ref.kind, ref.id);
		if (this.selectedEntities.has(key)) return false;
		this.selectedEntities.set(key, ref);
		this.announcement = `${ref.kind} ${ref.id} added to selection.`;
		return true;
	}

	toggleEntity(ref: EntityRef): boolean {
		if (this.activity.kind === CanvasActivityKind.Editing) return false;
		const key = entityKey(ref.kind, ref.id);
		if (!this.selectedEntities.has(key)) return this.addEntity(ref);
		this.selectedEntities.delete(key);
		this.announcement = `${ref.kind} ${ref.id} removed from selection.`;
		return true;
	}

	clearSelection(): boolean {
		if (this.activity.kind === CanvasActivityKind.Editing || this.selectedEntities.size === 0) {
			return false;
		}
		this.selectedEntities.clear();
		this.announcement = 'Selection cleared.';
		return true;
	}

	beginNodeMarkdownEdit(node: {
		readonly id: string;
		readonly markdown: string;
		readonly bounds: Bounds;
	}): boolean {
		if (this.activity.kind !== CanvasActivityKind.Idle) return false;
		const target = entityKey(EntityKind.Node, node.id);
		if (this.selectedEntities.size !== 1 || !this.selectedEntities.has(target)) return false;
		this.focusRequest = undefined;
		this.activity = {
			kind: CanvasActivityKind.Editing,
			target,
			nodeId: node.id,
			field: CanvasEditableField.Markdown,
			baseValue: node.markdown,
			draft: node.markdown,
			frozenBounds: { ...node.bounds },
			availability: CanvasEditAvailability.Available,
			diagnostic: undefined,
			saving: false,
			layoutRevision: this.layoutRevision,
			saveId: undefined,
		};
		this.announcement = `Editing node ${node.id}.`;
		return true;
	}

	queueNodeMarkdownEdit(node: NodeEditDraft, cancel?: () => void): boolean {
		this.focusRequest = undefined;
		this.pendingNodeEdit = queuePendingNodeEdit(this.selectedEntities, node);
		this.announcement = `Opening editor for new node ${node.id}.`;
		return this.pendingNodeCreation.queue(cancel);
	}

	updateDraft(draft: string): boolean {
		const editing = this.editing;
		if (editing === undefined) return false;
		if (editing.saving || editing.draft === draft) return false;
		this.activity = { ...editing, draft, diagnostic: undefined };
		return true;
	}

	async saveDraft(closeOnSuccess = true): Promise<DocumentCommandOutcome | undefined> {
		const editing = this.editing;
		if (editing === undefined) return undefined;
		const unavailable = editing.saving || editing.availability === CanvasEditAvailability.Deleted;
		if (unavailable) return undefined;
		const saveId = this.nextSaveId;
		this.nextSaveId += 1;
		this.activity = { ...editing, saving: true, diagnostic: undefined, saveId };
		let outcome: DocumentCommandOutcome;
		try {
			outcome = await this.commands.replaceNodeMarkdown(editing.nodeId, editing.draft);
		} catch (error) {
			outcome = { kind: DocumentCommandOutcomeKind.Failed, error };
		}
		const current = this.editing;
		if (current?.saveId !== saveId) return outcome;
		if (outcome.kind === DocumentCommandOutcomeKind.Accepted) {
			this.pendingNodeCreation.commit();
			if (current.availability === CanvasEditAvailability.Deleted) {
				this.activity = { ...current, saving: false, saveId: undefined };
				return outcome;
			}
			if (closeOnSuccess) {
				this.activity = idleCanvasActivity();
				this.focusRequest = {
					target: editing.target,
					afterLayoutRevision: editing.layoutRevision,
					ready: this.layoutRevision > editing.layoutRevision,
				};
			} else {
				this.activity = {
					...current,
					baseValue: current.draft,
					saving: false,
					diagnostic: undefined,
					layoutRevision: this.layoutRevision,
					saveId: undefined,
				};
			}
			this.announcement = `Node ${editing.nodeId} Markdown saved.`;
			return outcome;
		}
		const targetDeleted =
			outcome.kind !== DocumentCommandOutcomeKind.Failed &&
			outcome.diagnostics.some(({ code }) => code === NODE_NOT_FOUND_CODE);
		let availability = current.availability;
		if (targetDeleted) availability = CanvasEditAvailability.Deleted;
		this.activity = {
			...current,
			saving: false,
			availability,
			diagnostic: canvasCommandDiagnostic(outcome),
			saveId: undefined,
		};
		this.announcement = `Could not save node ${editing.nodeId}: ${canvasCommandDiagnostic(outcome)}`;
		return outcome;
	}

	cancel(commitCreation = false): boolean {
		const creationCancelled = this.pendingNodeCreation.finish(commitCreation);
		this.pendingNodeEdit = undefined;
		const editing = this.editing;
		if (editing !== undefined) {
			this.activity = idleCanvasActivity();
			this.focusRequest = {
				target: editing.target,
				afterLayoutRevision: this.layoutRevision,
				ready: true,
			};
			if (editing.saving)
				this.announcement = `Editor closed for node ${editing.nodeId}. Submitted change remains pending.`;
			else this.announcement = `Editing node ${editing.nodeId} cancelled.`;
			return true;
		}
		if (creationCancelled) return true;
		return this.clearSelection();
	}

	reconcile(index: CanvasEntityIndex): boolean {
		this.layoutRevision += 1;
		let changed = this.reconcileEditingTarget(index);
		if (this.openPendingNodeEdit(index)) changed = true;
		const editingTarget = this.editing?.target;
		const pendingTarget = this.pendingNodeEdit?.target;
		let removed = 0;
		for (const key of this.selectedEntities.keys()) {
			let retained = index.has(key) || key === editingTarget;
			if (!retained) retained = key === pendingTarget;
			if (retained) continue;
			this.selectedEntities.delete(key);
			removed += 1;
		}
		if (removed > 0) {
			changed = true;
			let subject = 'entities are';
			if (removed === 1) subject = 'entity is';
			this.announcement = `${removed} selected ${subject} no longer available.`;
		}
		const focusRequest = this.focusRequest;
		if (focusRequest !== undefined && this.layoutRevision > focusRequest.afterLayoutRevision) {
			changed = true;
			if (index.has(focusRequest.target)) this.focusRequest = { ...focusRequest, ready: true };
			else this.focusRequest = undefined;
		}
		return changed;
	}

	completeFocusRestoration(target: EntityKey): boolean {
		if (this.focusRequest?.target !== target || !this.focusRequest.ready) return false;
		this.focusRequest = undefined;
		return true;
	}

	private reconcileEditingTarget(index: CanvasEntityIndex): boolean {
		const editing = this.editing;
		if (editing === undefined) return false;
		const targetAvailable = index.has(editing.target);
		if (editing.availability === CanvasEditAvailability.Deleted || targetAvailable) return false;
		const diagnostic = `Node ${editing.nodeId} was removed. Your draft is preserved.`;
		this.activity = {
			...editing,
			availability: CanvasEditAvailability.Deleted,
			saving: false,
			diagnostic,
		};
		this.announcement = diagnostic;
		return true;
	}

	private openPendingNodeEdit(index: CanvasEntityIndex): boolean {
		const pending = this.pendingNodeEdit;
		const activity = pendingNodeEditActivity(pending, index, this.layoutRevision);
		if (activity === undefined) return false;
		this.pendingNodeEdit = undefined;
		this.activity = activity;
		this.announcement = `Editing new node ${activity.nodeId}.`;
		return true;
	}

	private updateZoom(zoom: number): boolean {
		if (zoom === this.zoom) return false;
		this.zoom = zoom;
		return true;
	}
}
