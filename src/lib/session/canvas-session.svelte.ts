import {
	DEFAULT_CANVAS_ZOOM,
	MAX_CANVAS_ZOOM,
	MIN_CANVAS_ZOOM,
	stepCanvasZoom,
} from '../canvas/canvas-viewport';

export class CanvasSession {
	zoom = $state(DEFAULT_CANVAS_ZOOM);

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

	private updateZoom(zoom: number): boolean {
		if (zoom === this.zoom) return false;
		this.zoom = zoom;
		return true;
	}
}
