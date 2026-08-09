import { describe, expect, it } from 'vitest';

import { CanvasSession } from '../../src/lib/session/canvas-session.svelte';

describe('CanvasSession viewport intents', () => {
	it('derives percentage and updates zoom through named intents', () => {
		const session = new CanvasSession();
		expect(session.zoomPercentage).toBe(100);
		expect(session.zoomIn()).toBe(true);
		expect(session.zoom).toBe(1.1);
		expect(session.zoomPercentage).toBe(110);
		expect(session.zoomOut()).toBe(true);
		expect(session.zoom).toBe(1);
	});

	it('resets zoom and reports an unchanged reset as a no-op', () => {
		const session = new CanvasSession();
		expect(session.resetZoom()).toBe(false);
		session.zoomOut();
		expect(session.resetZoom()).toBe(true);
		expect(session.zoom).toBe(1);
	});

	it('stays bounded and reports boundary intents as no-ops', () => {
		const session = new CanvasSession();
		for (let index = 0; index < 20; index += 1) session.zoomOut();
		expect(session.zoom).toBe(0.5);
		expect(session.canZoomOut).toBe(false);
		expect(session.zoomOut()).toBe(false);

		for (let index = 0; index < 20; index += 1) session.zoomIn();
		expect(session.zoom).toBe(2);
		expect(session.canZoomIn).toBe(false);
		expect(session.zoomIn()).toBe(false);
	});
});
