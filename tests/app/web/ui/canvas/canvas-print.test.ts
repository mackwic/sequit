import { describe, expect, it } from 'vitest';

import { PrintOrientation, printStageFit } from '../../../../../src/app/web/ui/canvas/canvas-print';

// 190 × 259.4 mm at 96 dpi: A4 and Letter portrait minus 10 mm margins, narrowed to what both share.
const PORTRAIT_WIDTH = 718.11;
const PORTRAIT_HEIGHT = 980.44;

describe('printStageFit', () => {
	it('keeps a stage that fits the sheet at its natural size, on a portrait sheet', () => {
		expect(printStageFit({ width: 600, height: 700 })).toEqual({
			orientation: PrintOrientation.Portrait,
			scale: 1,
		});
	});

	it('shrinks a wide stage into the landscape area', () => {
		const fit = printStageFit({ width: 2012, height: 1480 });

		expect(fit.orientation).toBe(PrintOrientation.Landscape);
		expect(fit.scale).toBeCloseTo(PORTRAIT_WIDTH / 1480, 4);
	});

	it('turns a tall stage portrait when that shows it larger', () => {
		const fit = printStageFit({ width: 900, height: 2400 });

		expect(fit.orientation).toBe(PrintOrientation.Portrait);
		expect(fit.scale).toBeCloseTo(PORTRAIT_HEIGHT / 2400, 4);
	});

	it('prefers portrait when both orientations fit equally', () => {
		expect(printStageFit({ width: 2000, height: 2000 }).orientation).toBe(
			PrintOrientation.Portrait,
		);
	});
});
