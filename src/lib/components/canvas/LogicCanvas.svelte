<script lang="ts">
	import { type Snippet, tick } from 'svelte';

	import { createCanvasEntityIndex } from '$lib/canvas/canvas-entity';
	import type { CanvasMeasurementModel, CanvasModel } from '$lib/canvas/canvas-model';
	import {
		anchorPreservingScroll,
		type CanvasPoint,
		DEFAULT_CANVAS_ZOOM,
		panScrollPosition,
	} from '$lib/canvas/canvas-viewport';
	import {
		collectLayoutMeasurements,
		layoutMeasurementSignature,
	} from '$lib/canvas/measure-canvas';
	import type { OpenDocumentResult } from '$lib/document/open-document';
	import type { CanvasSession, EditingCanvasActivity } from '$lib/session/canvas-session.svelte';

	import CanvasMeasurementLayer from './CanvasMeasurementLayer.svelte';
	import CanvasOverlay from './CanvasOverlay.svelte';
	import RenderedCanvas from './RenderedCanvas.svelte';

	type OpenedDocument = Pick<
		Extract<OpenDocumentResult, { readonly ok: true }>['value'],
		'measurementModel' | 'subscribe' | 'createCanvasModel'
	>;

	let {
		document: openedDocument,
		session,
		editor,
		hideToolbar = false,
		oncanvas,
	}: {
		document: OpenedDocument;
		session: CanvasSession;
		hideToolbar?: boolean;
		oncanvas?: ((canvas: CanvasModel, viewport: HTMLDivElement) => void) | undefined;
		editor?: Snippet<[EditingCanvasActivity, HTMLDivElement | undefined]> | undefined;
	} = $props();
	let measurementModel = $state<CanvasMeasurementModel>();
	let measurementLayer = $state<HTMLDivElement>();
	let viewport = $state<HTMLDivElement>();
	let canvas = $state<CanvasModel>();
	let lastAcceptedCanvas = $state<CanvasModel>();
	let error = $state<string>();
	let spacePressed = $state(false);
	let panning = $state(false);
	let panMoved = false;
	let suppressBackgroundActivation = false;
	let previousMeasurementSignature = '';
	let activeLayoutRequest: object | undefined;
	let pendingZoomAnchor: CanvasPoint | undefined;
	let appliedZoom = DEFAULT_CANVAS_ZOOM;
	let panStart:
		{ pointer: CanvasPoint; scroll: { left: number; top: number }; pointerId: number } | undefined;

	$effect(() => {
		const toZoom = session.zoom;
		if (toZoom === appliedZoom) return;
		const fromZoom = appliedZoom;
		const anchor = pendingZoomAnchor;
		pendingZoomAnchor = undefined;
		appliedZoom = toZoom;
		void tick().then(() => {
			preserveZoomAnchor(fromZoom, toZoom, anchor);
		});
	});

	$effect(() => {
		const current = openedDocument;
		measurementModel = current.measurementModel;
		return current.subscribe(() => {
			measurementModel = current.measurementModel;
		});
	});

	async function recalculate(current: OpenedDocument = openedDocument) {
		const layer = measurementLayer;
		if (layer === undefined) return;
		const measurements = collectLayoutMeasurements(layer);
		const signature = layoutMeasurementSignature(measurements);
		if (signature === previousMeasurementSignature) return;
		previousMeasurementSignature = signature;
		const request = {};
		activeLayoutRequest = request;
		try {
			const result = await current.createCanvasModel(measurements);
			if (activeLayoutRequest === request) {
				canvas = result;
				lastAcceptedCanvas = result;
				error = undefined;
				session.reconcile(createCanvasEntityIndex(result));
			}
		} catch (cause) {
			if (activeLayoutRequest === request) {
				error = cause instanceof Error ? cause.message : String(cause);
			}
		}
	}

	function preserveZoomAnchor(fromZoom: number, toZoom: number, requestedAnchor?: CanvasPoint) {
		if (!viewport || !canvas) return;
		const anchor = requestedAnchor ?? {
			x: viewport.clientWidth / 2,
			y: viewport.clientHeight / 2,
		};
		const next = anchorPreservingScroll({
			stage: { width: canvas.width, height: canvas.height },
			viewport: { width: viewport.clientWidth, height: viewport.clientHeight },
			anchor,
			scroll: { left: viewport.scrollLeft, top: viewport.scrollTop },
			fromZoom,
			toZoom,
		});
		viewport.scrollTo(next.left, next.top);
	}

	function handleWheel(event: WheelEvent) {
		if ((!event.ctrlKey && !event.metaKey) || !viewport) return;
		event.preventDefault();
		const bounds = viewport.getBoundingClientRect();
		pendingZoomAnchor = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
		if (event.deltaY < 0) session.zoomIn();
		else if (event.deltaY > 0) session.zoomOut();
	}

	let scope = $state<HTMLDivElement>();
	function handleKeyDown(event: KeyboardEvent) {
		if (event.defaultPrevented || !(event.target instanceof Node)) return;
		const focusedHere = scope?.contains(event.target) === true;
		if (event.code === 'Escape') {
			if (focusedHere && session.cancel()) event.preventDefault();
			return;
		}
		const hoveredWithoutControlFocus =
			event.target === document.body && viewport?.matches(':hover') === true;
		if (
			event.code !== 'Space' ||
			event.repeat ||
			event.isComposing ||
			event.ctrlKey ||
			event.metaKey ||
			event.altKey ||
			event.shiftKey ||
			(!focusedHere && !hoveredWithoutControlFocus) ||
			isNativeControl(event.target) ||
			isCanvasEntity(event.target)
		)
			return;
		spacePressed = true;
		event.preventDefault();
	}

	function handleKeyUp(event: KeyboardEvent) {
		if (event.code !== 'Space') return;
		spacePressed = false;
		finishPanning();
	}

	function isNativeControl(target: EventTarget | null): boolean {
		return (
			target instanceof Element &&
			target.closest('button, a, input, textarea, select, [contenteditable="true"]') !== null
		);
	}

	function isCanvasBackground(target: EventTarget | null): boolean {
		return (
			target instanceof Element &&
			target.closest('[data-node-id], [data-group-id], [data-junction-id], [data-relation-id]') ===
				null
		);
	}

	function isCanvasEntity(target: EventTarget | null): boolean {
		return target instanceof Element && !isCanvasBackground(target);
	}

	function startPanning(event: PointerEvent) {
		if (isCanvasBackground(event.target) && !isNativeControl(event.target))
			viewport?.focus({ preventScroll: true });
		if (!spacePressed || event.button !== 0 || !viewport || !isCanvasBackground(event.target))
			return;
		event.preventDefault();
		viewport.setPointerCapture(event.pointerId);
		panStart = {
			pointer: { x: event.clientX, y: event.clientY },
			scroll: { left: viewport.scrollLeft, top: viewport.scrollTop },
			pointerId: event.pointerId,
		};
		panMoved = false;
		panning = true;
	}

	function continuePanning(event: PointerEvent) {
		if (!viewport || panStart?.pointerId !== event.pointerId) return;
		if (event.clientX !== panStart.pointer.x || event.clientY !== panStart.pointer.y)
			panMoved = true;
		const next = panScrollPosition({
			startScroll: panStart.scroll,
			startPointer: panStart.pointer,
			pointer: { x: event.clientX, y: event.clientY },
			maxScroll: {
				left: viewport.scrollWidth - viewport.clientWidth,
				top: viewport.scrollHeight - viewport.clientHeight,
			},
		});
		viewport.scrollTo(next.left, next.top);
	}

	function finishPanning() {
		if (panning && panMoved) suppressBackgroundActivation = true;
		panStart = undefined;
		panMoved = false;
		panning = false;
	}

	function handleBackgroundClick(event: MouseEvent) {
		if (suppressBackgroundActivation) {
			suppressBackgroundActivation = false;
			return;
		}
		if (isCanvasBackground(event.target)) session.clearSelection();
	}

	$effect(() => {
		const target = session.focusRestorationTarget;
		const currentViewport = viewport;
		const currentCanvas = canvas;
		if (target === undefined || currentViewport === undefined || currentCanvas === undefined)
			return;
		void tick().then(() => {
			for (const candidate of currentViewport.querySelectorAll<HTMLElement | SVGElement>(
				'[data-canvas-entity-key]',
			)) {
				if (candidate.getAttribute('data-canvas-entity-key') !== target) continue;
				candidate.focus();
				session.completeFocusRestoration(target);
				return;
			}
		});
	});

	$effect(() => {
		const layer = measurementLayer;
		const current = openedDocument;
		const currentMeasurementModel = measurementModel;
		canvas = undefined;
		previousMeasurementSignature = '';
		activeLayoutRequest = undefined;
		error = undefined;
		if (
			!layer ||
			currentMeasurementModel === undefined ||
			currentMeasurementModel !== measurementModel
		)
			return;

		let cancelled = false;
		const resizeObserver = new ResizeObserver(() => void scheduleRecalculation());
		const observeMeasuredElements = () => {
			resizeObserver.disconnect();
			for (const element of layer.querySelectorAll<HTMLElement>(
				'[data-measure-node], [data-measure-group], [data-measure-junction]',
			)) {
				resizeObserver.observe(element);
			}
		};
		const scheduleRecalculation = async () => {
			await document.fonts.ready;
			await tick();
			if (!cancelled) await recalculate(current);
		};
		const mutationObserver = new MutationObserver(() => {
			observeMeasuredElements();
			void scheduleRecalculation();
		});

		observeMeasuredElements();
		mutationObserver.observe(layer, { childList: true, subtree: true, characterData: true });
		void scheduleRecalculation();

		return () => {
			cancelled = true;
			resizeObserver.disconnect();
			mutationObserver.disconnect();
		};
	});
	$effect(() => {
		if (canvas && viewport) oncanvas?.(canvas, viewport);
	});
</script>

<svelte:window onkeydown={handleKeyDown} onkeyup={handleKeyUp} onblur={finishPanning} />

<div class="contents" bind:this={scope}>
	{#if measurementModel}
		<CanvasMeasurementLayer model={measurementModel} bind:element={measurementLayer} />
	{/if}

	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div
		class:cursor-grab={spacePressed && !panning}
		class:cursor-grabbing={panning}
		class="canvas-grid absolute inset-0 overflow-auto overscroll-contain"
		role="region"
		aria-label="Canvas viewport"
		data-canvas-viewport
		tabindex="-1"
		bind:this={viewport}
		onwheel={handleWheel}
		onpointerdown={startPanning}
		onpointermove={continuePanning}
		onpointerup={finishPanning}
		onpointercancel={finishPanning}
		onclick={handleBackgroundClick}
	>
		{#if error}
			<p class="m-8 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</p>
		{:else if canvas}
			<RenderedCanvas {canvas} zoom={session.zoom} {session} />
		{:else}
			<p class="m-8 text-sm text-stone-500">Measuring document…</p>
		{/if}
	</div>

	<CanvasOverlay
		canvas={lastAcceptedCanvas}
		viewportElement={viewport}
		{session}
		{editor}
		{hideToolbar}
	/>
</div>

<style>
	.canvas-grid {
		background-color: #f5f5f4;
		background-image: radial-gradient(#d6d3d1 0.8px, transparent 0.8px);
		background-size: 20px 20px;
	}
</style>
