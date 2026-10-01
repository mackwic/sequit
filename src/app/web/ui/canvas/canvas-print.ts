import type { CanvasSize } from './canvas-viewport';

export enum PrintOrientation {
	Portrait = 'portrait',
	Landscape = 'landscape',
}

export interface PrintFit {
	/** The sheet orientation that shows the stage largest. */
	readonly orientation: PrintOrientation;
	/** The zoom fitting the stage on one sheet of that orientation. */
	readonly scale: number;
}

const CSS_PIXELS_PER_MM = 96 / 25.4;
/** The margin printed around the stage; `@page` in `layout.css` uses the same value. */
const PRINT_MARGIN_MM = 10;
/** The printable portrait area common to A4 (210 × 297 mm) and Letter (215.9 × 279.4 mm). */
const PORTRAIT_SHEET_MM: CanvasSize = { width: 210, height: 279.4 };

const portraitArea: CanvasSize = {
	width: (PORTRAIT_SHEET_MM.width - 2 * PRINT_MARGIN_MM) * CSS_PIXELS_PER_MM,
	height: (PORTRAIT_SHEET_MM.height - 2 * PRINT_MARGIN_MM) * CSS_PIXELS_PER_MM,
};

/** How a stage fits on one printed sheet: it never grows, and shrinks to the common A4/Letter area. */
export function printStageFit(stage: CanvasSize): PrintFit {
	const portrait = Math.min(
		1,
		portraitArea.width / stage.width,
		portraitArea.height / stage.height,
	);
	const landscape = Math.min(
		1,
		portraitArea.height / stage.width,
		portraitArea.width / stage.height,
	);
	if (landscape > portrait) return { orientation: PrintOrientation.Landscape, scale: landscape };
	return { orientation: PrintOrientation.Portrait, scale: portrait };
}
