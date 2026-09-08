import type { LayoutMeasurements } from '../../../lib/core/layout/layout-types';
import type { CanvasMeasurementModel, CanvasModel } from '../ui/canvas/canvas-model';

/** Live visual projection supplied by either the product or the development workshop. */
export interface CanvasProjection {
	readonly measurementModel: CanvasMeasurementModel;
	subscribe(subscriber: () => void): () => void;
	createCanvasModel(measurements: LayoutMeasurements): Promise<CanvasModel>;
}
