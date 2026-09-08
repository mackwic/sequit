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

export interface CanvasDocumentCommandPort {
	readonly replaceNodeMarkdown: (
		nodeId: string,
		markdown: string,
	) => Promise<DocumentCommandOutcome>;
}

export enum CanvasActivityKind {
	Idle = 'idle',
	Editing = 'editing',
}

export enum CanvasEditAvailability {
	Available = 'available',
	Deleted = 'deleted',
}

enum CanvasEditableField {
	Markdown = 'markdown',
}

interface IdleCanvasActivity {
	readonly kind: CanvasActivityKind.Idle;
}

export interface EditingCanvasActivity {
	readonly kind: CanvasActivityKind.Editing;
	readonly target: EntityKey;
	readonly nodeId: string;
	readonly field: CanvasEditableField;
	readonly baseValue: string;
	readonly draft: string;
	readonly frozenBounds: Bounds;
	readonly availability: CanvasEditAvailability;
	readonly diagnostic: string | undefined;
	readonly saving: boolean;
	readonly layoutRevision: number;
	readonly saveId: number | undefined;
}

export type CanvasActivity = IdleCanvasActivity | EditingCanvasActivity;

interface CanvasFocusRequest {
	readonly target: EntityKey;
	readonly afterLayoutRevision: number;
	readonly ready: boolean;
}

const idleActivity = (): IdleCanvasActivity => ({ kind: CanvasActivityKind.Idle });
const NODE_NOT_FOUND_CODE: string = DocumentCommandDiagnosticCode.NodeNotFound;

const unavailableCommands: CanvasDocumentCommandPort = {
	replaceNodeMarkdown: (nodeId) => {
		return Promise.resolve({
			kind: DocumentCommandOutcomeKind.Rejected,
			diagnostics: [
				{
					code: DocumentCommandDiagnosticCode.NodeMarkdownUnavailable,
					message: `Node Markdown editing is unavailable: ${nodeId}`,
					path: ['nodes', nodeId, 'markdown'],
				},
			],
		});
	},
};

interface AcceptedCommandOutcome {
	readonly kind: DocumentCommandOutcomeKind.Accepted;
}

function outcomeDiagnostic(outcome: Exclude<DocumentCommandOutcome, AcceptedCommandOutcome>) {
	if (outcome.kind === DocumentCommandOutcomeKind.Failed) {
		if (outcome.error instanceof Error) return outcome.error.message;
		return String(outcome.error);
	}
	return outcome.diagnostics.map(({ message }) => message).join('; ');
}

export class CanvasSession {
	zoom = $state(DEFAULT_CANVAS_ZOOM);
	private readonly selectedEntities = new SvelteMap<EntityKey, EntityRef>();
	activity = $state<CanvasActivity>(idleActivity());
	announcement = $state('');
	private focusRequest = $state<CanvasFocusRequest>();
	private layoutRevision = 0;
	private nextSaveId = 1;
	readonly selectModeActive = true;

	constructor(private readonly commands: CanvasDocumentCommandPort = unavailableCommands) {}

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

	get contextualNodeKey(): EntityKey | undefined {
		if (this.activity.kind !== CanvasActivityKind.Idle || this.selectedEntities.size !== 1) {
			return undefined;
		}
		const selected = [...this.selectedEntities.entries()][0];
		if (selected?.[1].kind !== EntityKind.Node) return undefined;
		return selected[0];
	}

	get focusRestorationTarget(): EntityKey | undefined {
		if (this.focusRequest?.ready !== true) return undefined;
		return this.focusRequest.target;
	}

	get awaitingAcceptedLayout(): boolean {
		return this.focusRequest !== undefined && !this.focusRequest.ready;
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
		this.announceSelection(ref, 'selected');
		return true;
	}

	addEntity(ref: EntityRef): boolean {
		if (this.activity.kind === CanvasActivityKind.Editing) return false;
		const key = entityKey(ref.kind, ref.id);
		if (this.selectedEntities.has(key)) return false;
		this.selectedEntities.set(key, ref);
		this.announceSelection(ref, 'added to selection');
		return true;
	}

	toggleEntity(ref: EntityRef): boolean {
		if (this.activity.kind === CanvasActivityKind.Editing) return false;
		const key = entityKey(ref.kind, ref.id);
		if (!this.selectedEntities.has(key)) return this.addEntity(ref);
		this.selectedEntities.delete(key);
		this.announceSelection(ref, 'removed from selection');
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

	updateDraft(draft: string): boolean {
		const editing = this.editing;
		if (editing === undefined) return false;
		if (editing.saving || editing.draft === draft) return false;
		this.activity = { ...editing, draft, diagnostic: undefined };
		return true;
	}

	async saveDraft(): Promise<DocumentCommandOutcome | undefined> {
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
			if (current.availability === CanvasEditAvailability.Deleted) {
				this.activity = { ...current, saving: false, saveId: undefined };
				return outcome;
			}
			this.activity = idleActivity();
			this.focusRequest = {
				target: editing.target,
				afterLayoutRevision: editing.layoutRevision,
				ready: this.layoutRevision > editing.layoutRevision,
			};
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
			diagnostic: outcomeDiagnostic(outcome),
			saveId: undefined,
		};
		this.announcement = `Could not save node ${editing.nodeId}: ${outcomeDiagnostic(outcome)}`;
		return outcome;
	}

	cancel(): boolean {
		const editing = this.editing;
		if (editing !== undefined) {
			this.activity = idleActivity();
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
		return this.clearSelection();
	}

	reconcile(index: CanvasEntityIndex): boolean {
		this.layoutRevision += 1;
		let changed = this.reconcileEditingTarget(index);
		const editingTarget = this.editing?.target;
		let removed = 0;
		for (const key of this.selectedEntities.keys()) {
			if (index.has(key) || key === editingTarget) continue;
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

	private updateZoom(zoom: number): boolean {
		if (zoom === this.zoom) return false;
		this.zoom = zoom;
		return true;
	}

	private announceSelection(ref: EntityRef, action: string): void {
		this.announcement = `${ref.kind} ${ref.id} ${action}.`;
	}
}
