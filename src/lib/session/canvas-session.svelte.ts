import { SvelteMap } from 'svelte/reactivity';

import {
	type CanvasEntityIndex,
	type EntityKey,
	entityKey,
	type EntityRef,
} from '../canvas/canvas-entity';
import {
	DEFAULT_CANVAS_ZOOM,
	MAX_CANVAS_ZOOM,
	MIN_CANVAS_ZOOM,
	stepCanvasZoom,
} from '../canvas/canvas-viewport';

export class CanvasSession {
	zoom = $state(DEFAULT_CANVAS_ZOOM);
	private readonly selectedEntities = new SvelteMap<EntityKey, EntityRef>();
	announcement = $state('');
	readonly selectModeActive = true;

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
		const key = entityKey(ref.kind, ref.id);
		if (this.selectedEntities.size === 1 && this.selectedEntities.has(key)) return false;
		this.selectedEntities.clear();
		this.selectedEntities.set(key, ref);
		this.announceSelection(ref, 'selected');
		return true;
	}

	addEntity(ref: EntityRef): boolean {
		const key = entityKey(ref.kind, ref.id);
		if (this.selectedEntities.has(key)) return false;
		this.selectedEntities.set(key, ref);
		this.announceSelection(ref, 'added to selection');
		return true;
	}

	toggleEntity(ref: EntityRef): boolean {
		const key = entityKey(ref.kind, ref.id);
		if (!this.selectedEntities.has(key)) return this.addEntity(ref);
		this.selectedEntities.delete(key);
		this.announceSelection(ref, 'removed from selection');
		return true;
	}

	clearSelection(): boolean {
		if (this.selectedEntities.size === 0) return false;
		this.selectedEntities.clear();
		this.announcement = 'Selection cleared.';
		return true;
	}

	cancel(): boolean {
		return this.clearSelection();
	}

	reconcile(index: CanvasEntityIndex): boolean {
		let removed = 0;
		for (const key of this.selectedEntities.keys()) {
			if (index.has(key)) continue;
			this.selectedEntities.delete(key);
			removed += 1;
		}
		if (removed === 0) return false;
		let subject = 'entities are';
		if (removed === 1) subject = 'entity is';
		this.announcement = `${removed} selected ${subject} no longer available.`;
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
