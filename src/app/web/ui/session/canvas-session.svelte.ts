import { SvelteMap } from 'svelte/reactivity';

import type { Bounds } from '../../../../lib/core/layout/layout-types';
import {
	DocumentCommandDiagnosticCode,
	type DocumentCommandOutcome,
	DocumentCommandOutcomeKind,
} from '../../../../lib/infrastructure/document/document-command-contracts';
import type { NodeFields } from '../../../../lib/infrastructure/document/node-fields';
import { m } from '../../i18n/paraglide/messages';
import { translateCommandDiagnostics, translateSessionError } from '../../i18n/session-messages';
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
	type CanvasDocumentCommandPort,
	CanvasEditAvailability,
	type EditingCanvasActivity,
	idleCanvasActivity,
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
	private layoutRevision = 0;
	private nextSaveId = 1;

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
		this.announcement = m.collaboration_announcement_selected({ kind: ref.kind, id: ref.id });
		return true;
	}

	addEntity(ref: EntityRef): boolean {
		if (this.activity.kind === CanvasActivityKind.Editing) return false;
		const key = entityKey(ref.kind, ref.id);
		if (this.selectedEntities.has(key)) return false;
		this.selectedEntities.set(key, ref);
		this.announcement = m.collaboration_announcement_added({ kind: ref.kind, id: ref.id });
		return true;
	}

	toggleEntity(ref: EntityRef): boolean {
		if (this.activity.kind === CanvasActivityKind.Editing) return false;
		const key = entityKey(ref.kind, ref.id);
		if (!this.selectedEntities.has(key)) return this.addEntity(ref);
		this.selectedEntities.delete(key);
		this.announcement = m.collaboration_announcement_removed({ kind: ref.kind, id: ref.id });
		return true;
	}

	clearSelection(): boolean {
		if (this.activity.kind === CanvasActivityKind.Editing || this.selectedEntities.size === 0) {
			return false;
		}
		this.selectedEntities.clear();
		this.announcement = m.collaboration_announcement_selection_cleared();
		return true;
	}

	/** Opens the box dialog on the sole selected node; its fields come from the document. */
	beginNodeEdit(node: { readonly id: string; readonly bounds: Bounds }): boolean {
		if (this.activity.kind !== CanvasActivityKind.Idle) return false;
		const target = entityKey(EntityKind.Node, node.id);
		if (this.selectedEntities.size !== 1 || !this.selectedEntities.has(target)) return false;
		const base = this.commands.readNode(node.id);
		if (base === undefined) return false;
		this.focusRequest = undefined;
		this.activity = {
			kind: CanvasActivityKind.Editing,
			target,
			nodeId: node.id,
			base,
			draft: base,
			frozenBounds: { ...node.bounds },
			availability: CanvasEditAvailability.Available,
			diagnostic: undefined,
			saving: false,
			layoutRevision: this.layoutRevision,
			saveId: undefined,
		};
		this.announcement = m.collaboration_announcement_editing_node({ id: node.id });
		return true;
	}

	updateDraft(patch: Partial<NodeFields>): boolean {
		const editing = this.editing;
		if (editing === undefined || editing.saving) return false;
		const draft = { ...editing.draft, ...patch };
		const keys: readonly (keyof NodeFields)[] = [
			'natureId',
			'markdown',
			'description',
			'color',
			'icon',
			'laneId',
		];
		if (keys.every((key) => editing.draft[key] === draft[key])) return false;
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
			outcome = await this.commands.saveNode(editing.nodeId, editing.base, editing.draft);
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
			this.activity = idleCanvasActivity();
			this.focusRequest = {
				target: editing.target,
				afterLayoutRevision: editing.layoutRevision,
				ready: this.layoutRevision > editing.layoutRevision,
			};
			this.announcement = m.collaboration_announcement_node_saved({ id: editing.nodeId });
			return outcome;
		}
		const targetDeleted =
			outcome.kind !== DocumentCommandOutcomeKind.Failed &&
			outcome.diagnostics.some(({ code }) => code === NODE_NOT_FOUND_CODE);
		let availability = current.availability;
		if (targetDeleted) availability = CanvasEditAvailability.Deleted;
		let diagnostic: string;
		if (outcome.kind === DocumentCommandOutcomeKind.Failed)
			diagnostic = translateSessionError(outcome.error);
		else diagnostic = translateCommandDiagnostics(outcome.diagnostics);
		this.activity = {
			...current,
			saving: false,
			availability,
			diagnostic,
			saveId: undefined,
		};
		this.announcement = m.collaboration_announcement_node_save_failed({
			id: editing.nodeId,
			message: diagnostic,
		});
		return outcome;
	}

	cancel(): boolean {
		const editing = this.editing;
		if (editing !== undefined) {
			this.activity = idleCanvasActivity();
			this.focusRequest = {
				target: editing.target,
				afterLayoutRevision: this.layoutRevision,
				ready: true,
			};
			if (editing.saving)
				this.announcement = m.collaboration_announcement_editor_closed_pending({
					id: editing.nodeId,
				});
			else
				this.announcement = m.collaboration_announcement_editing_cancelled({ id: editing.nodeId });
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
			this.announcement = m.collaboration_announcement_selection_gone({ count: removed });
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
		const diagnostic = m.collaboration_announcement_node_removed({ id: editing.nodeId });
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
}
