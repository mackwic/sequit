import { describe, expect, it } from 'vitest';

import {
	anchorPreservingScroll,
	centeredStageOrigin,
	clampCanvasZoom,
	panScrollPosition,
	revealScrollDelta,
	scaledStageExtent,
	stepCanvasZoom,
} from '../../../../../src/app/web/ui/canvas/canvas-viewport';

describe('canvas viewport calculations', () => {
	it('clamps zoom and advances in deterministic decimal steps', () => {
		expect(clampCanvasZoom(0.05)).toBe(0.1);
		expect(clampCanvasZoom(3)).toBe(2.5);
		expect(stepCanvasZoom(1, 1)).toBe(1.1);
		expect(stepCanvasZoom(1.1, -1)).toBe(1);
		expect(stepCanvasZoom(0.1, -1)).toBe(0.1);
		expect(stepCanvasZoom(2.5, 1)).toBe(2.5);
	});

	it('includes unscaled stage padding in fractional zoom extents', () => {
		expect(scaledStageExtent({ width: 400, height: 200 }, 0.75)).toEqual({
			width: 428,
			height: 278,
		});
	});

	it('centers small stages while retaining minimum padding', () => {
		expect(
			centeredStageOrigin({ width: 800, height: 600 }, { width: 400, height: 200 }, 1),
		).toEqual({ x: 200, y: 200 });
		expect(
			centeredStageOrigin({ width: 300, height: 200 }, { width: 400, height: 200 }, 1),
		).toEqual({ x: 64, y: 64 });
	});

	it('preserves a pointer-anchored document point while zooming', () => {
		expect(
			anchorPreservingScroll({
				stage: { width: 1_000, height: 800 },
				viewport: { width: 500, height: 400 },
				anchor: { x: 125, y: 100 },
				scroll: { left: 250, top: 200 },
				fromZoom: 1,
				toZoom: 1.5,
			}),
		).toEqual({ left: 405.5, top: 318 });
	});

	it('preserves the viewport center and clamps scroll at padded boundaries', () => {
		expect(
			anchorPreservingScroll({
				stage: { width: 1_000, height: 800 },
				viewport: { width: 500, height: 400 },
				anchor: { x: 250, y: 200 },
				scroll: { left: 0, top: 0 },
				fromZoom: 1,
				toZoom: 0.5,
			}),
		).toEqual({ left: 0, top: 0 });
	});

	it('converts pointer movement to bounded inverse scroll deltas', () => {
		expect(
			panScrollPosition({
				startScroll: { left: 100, top: 80 },
				startPointer: { x: 200, y: 150 },
				pointer: { x: 150, y: 200 },
				maxScroll: { left: 130, top: 100 },
			}),
		).toEqual({ left: 130, top: 30 });
	});

	it('scrolls to reveal a target only along an axis where it does not show whole', () => {
		const viewport = { left: 0, top: 50, width: 1000, height: 600 };
		const inside = { left: 100, top: 100, width: 200, height: 100 };
		expect(revealScrollDelta(viewport, inside, 40)).toEqual({ x: 0, y: 0 });
		// Within the margin counts as hidden: the target is centred along that axis only.
		const lower = { left: 100, top: 600, width: 200, height: 100 };
		expect(revealScrollDelta(viewport, lower, 40)).toEqual({ x: 0, y: 650 - 350 });
		const leftward = { left: -500, top: 100, width: 200, height: 100 };
		expect(revealScrollDelta(viewport, leftward, 40)).toEqual({ x: -400 - 500, y: 0 });
		// Larger than the viewport: its start is shown, the margin kept.
		const wide = { left: 1200, top: 100, width: 2000, height: 100 };
		expect(revealScrollDelta(viewport, wide, 40)).toEqual({ x: 1160, y: 0 });
	});
});
