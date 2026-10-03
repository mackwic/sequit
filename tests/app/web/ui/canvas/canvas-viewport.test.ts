import { describe, expect, it } from 'vitest';

import {
	anchorPreservingScroll,
	canvasPanOffset,
	canvasStageMargin,
	centeredStageOrigin,
	clampCanvasZoom,
	homeCanvasZoom,
	pannedScroll,
	panScrollPosition,
	revealScrollDelta,
	scaledStageExtent,
	stepCanvasZoom,
} from '../../../../../src/app/web/ui/canvas/canvas-viewport';

const large = {
	stage: { width: 1_000, height: 800 },
	viewport: { width: 500, height: 400 },
	zoom: 1,
};

describe('canvas viewport calculations', () => {
	it('clamps zoom and advances in deterministic decimal steps', () => {
		expect(clampCanvasZoom(0.05)).toBe(0.1);
		expect(clampCanvasZoom(3)).toBe(2.5);
		expect(stepCanvasZoom(1, 1)).toBe(1.1);
		expect(stepCanvasZoom(1.1, -1)).toBe(1);
		expect(stepCanvasZoom(0.1, -1)).toBe(0.1);
		expect(stepCanvasZoom(2.5, 1)).toBe(2.5);
	});

	it('starts canvases narrower than the small-screen breakpoint smaller', () => {
		expect(homeCanvasZoom(639)).toBe(0.7);
		expect(homeCanvasZoom(640)).toBe(1);
	});

	it('includes unscaled stage margins in fractional zoom extents', () => {
		expect(scaledStageExtent({ width: 400, height: 200 }, 0.75)).toEqual({
			width: 428,
			height: 278,
		});
		expect(scaledStageExtent({ width: 400, height: 200 }, 0.75, { x: 10, y: 20 })).toEqual({
			width: 320,
			height: 190,
		});
	});

	it('leaves almost a viewport to pan on each side, never less than the stage padding', () => {
		expect(canvasStageMargin({ width: 800, height: 100 })).toEqual({ x: 736, y: 64 });
	});

	it('centers small stages while retaining minimum padding', () => {
		expect(
			centeredStageOrigin({ width: 800, height: 600 }, { width: 400, height: 200 }, 1),
		).toEqual({ x: 200, y: 200 });
		expect(
			centeredStageOrigin({ width: 300, height: 200 }, { width: 400, height: 200 }, 1),
		).toEqual({ x: 64, y: 64 });
	});

	it('frames an unpanned stage as it would sit without margin', () => {
		const small = { stage: { width: 400, height: 200 }, viewport: { width: 800, height: 600 } };
		// Margins 736 × 536: the stage sits 200 px from the viewport edges, centred.
		expect(pannedScroll({ ...small, zoom: 1 }, { x: 0, y: 0 })).toEqual({ left: 536, top: 336 });
		// Margins 436 × 336: a larger stage starts at the stage padding.
		expect(pannedScroll(large, { x: 0, y: 0 })).toEqual({ left: 372, top: 272 });
	});

	it('pans until a sliver of the stage is left on either side, and round-trips offsets', () => {
		expect(pannedScroll(large, { x: -10_000, y: -10_000 })).toEqual({ left: 0, top: 0 });
		// The content spans 1000 + 2 × 436 by 800 + 2 × 336.
		expect(pannedScroll(large, { x: 10_000, y: 10_000 })).toEqual({ left: 1_372, top: 1_072 });
		expect(canvasPanOffset(large, pannedScroll(large, { x: -120, y: 45 }))).toEqual({
			x: -120,
			y: 45,
		});
	});

	it('preserves a pointer-anchored document point while zooming', () => {
		// (500 + 125 - 436, 400 + 100 - 336) is document point (189, 164) at both zooms.
		expect(
			anchorPreservingScroll({
				from: large,
				to: { ...large, zoom: 1.5 },
				anchor: { x: 125, y: 100 },
				scroll: { left: 500, top: 400 },
			}),
		).toEqual({ left: 594.5, top: 482 });
	});

	it('clamps an anchored zoom at the margin boundaries', () => {
		expect(
			anchorPreservingScroll({
				from: large,
				to: { ...large, zoom: 2.5 },
				anchor: { x: 250, y: 200 },
				scroll: { left: 0, top: 0 },
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
