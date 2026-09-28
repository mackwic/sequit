<script lang="ts">
	import { type Snippet, tick, untrack } from 'svelte';

	import { compareCanonicalStrings } from '../../../../../lib/core/canonical-string';
	import type { InvalidSourceDocumentState } from '../../../../../lib/infrastructure/collaboration/source-document-state';
	import type { CanvasProjection } from '../../../projection/canvas-projection';
	import {
		type LayoutDiagnostic,
		LayoutProjectionError,
	} from '../../../projection/layout-diagnostic';
	import { type RegionPreview, RegionPreviewKind } from '../../../projection/partial-region-layout';
	import { SourceDocumentProjectionError } from '../../../projection/source-document-diagnostic';
	import { createCanvasEntityIndex } from '../../canvas/canvas-entity';
	import type { CanvasMeasurementModel, CanvasModel } from '../../canvas/canvas-model';
	import {
		anchorPreservingScroll,
		type CanvasPoint,
		DEFAULT_CANVAS_ZOOM,
		panScrollPosition,
	} from '../../canvas/canvas-viewport';
	import {
		collectLayoutMeasurements,
		layoutMeasurementSignature,
	} from '../../canvas/measure-canvas';
	import type { CanvasSession, EditingCanvasActivity } from '../../session/canvas-session.svelte';
	import CanvasMeasurementLayer from './CanvasMeasurementLayer.svelte';
	import CanvasOverlay from './CanvasOverlay.svelte';
	import RegionPartialPreview from './RegionPartialPreview.svelte';
	import RenderedCanvas from './RenderedCanvas.svelte';

	let {
		document: openedDocument,
		session,
		editor,
		awareness,
		hideToolbar = false,
		oncanvas,
		onGroup,
		onDelete,
		onGroupEdit,
	}: {
		document: CanvasProjection;
		session: CanvasSession;
		hideToolbar?: boolean;
		oncanvas?: ((canvas: CanvasModel, viewport: HTMLDivElement) => void) | undefined;
		onGroup?: () => void;
		onDelete?: () => void;
		onGroupEdit?: (groupId: string) => void;
		editor?: Snippet<[EditingCanvasActivity, HTMLDivElement | undefined]> | undefined;
		awareness?: Snippet<[CanvasModel, HTMLDivElement]> | undefined;
	} = $props();
	let measurementModel = $state.raw<CanvasMeasurementModel>();
	let measurementLayer = $state<HTMLDivElement>();
	let viewport = $state<HTMLDivElement>();
	// Projection snapshots are immutable; deep proxies would track every geometry read.
	type CanvasDisplay =
		| { readonly kind: 'measuring' }
		| { readonly kind: 'ready'; readonly canvas: CanvasModel }
		| { readonly kind: 'diagnostic'; readonly diagnostic: LayoutDiagnostic | undefined }
		| {
				readonly kind: 'partial';
				readonly diagnostic: LayoutDiagnostic;
				readonly regions: readonly RegionPreview[];
		  }
		| { readonly kind: 'invalid-source'; readonly state: InvalidSourceDocumentState };
	let display = $state.raw<CanvasDisplay>({ kind: 'measuring' });
	let canvas = $derived(display.kind === 'ready' ? display.canvas : undefined);
	let spacePressed = $state(false);
	let panning = $state(false);
	let panMoved = false;
	let suppressBackgroundActivation = false;
	let previousMeasurementSignature = '';
	let projectionRevision = $state(0);
	let acceptedRevision = $state(0);
	let previousProjectionRevision = -1;
	let activeLayoutRequest: object | undefined;
	let pendingZoomAnchor: CanvasPoint | undefined;
	let appliedZoom = DEFAULT_CANVAS_ZOOM;
	let panStart:
		| {
				pointer: CanvasPoint;
				scroll: { left: number; top: number };
				pointerId: number;
		  }
		| undefined;

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
		untrack(() => {
			projectionRevision += 1;
		});
		return current.subscribe(() => {
			measurementModel = current.measurementModel;
			projectionRevision += 1;
		});
	});

	async function recalculate(current: CanvasProjection, revision: number) {
		const layer = measurementLayer;
		if (layer === undefined) return;
		const start = performance.now();
		const measurements = collectLayoutMeasurements(layer);
		const signature = layoutMeasurementSignature(measurements);
		if (signature === previousMeasurementSignature && revision === previousProjectionRevision)
			return;
		previousMeasurementSignature = signature;
		previousProjectionRevision = revision;
		const request = {};
		activeLayoutRequest = request;
		try {
			const result = await current.createCanvasModel(measurements);
			if (
				activeLayoutRequest === request &&
				revision === projectionRevision &&
				current === openedDocument
			) {
				display = { kind: 'ready', canvas: result };
				acceptedRevision += 1;
				session.reconcile(createCanvasEntityIndex(result));
				performance.clearMeasures('sequit:canvas-projection');
				performance.measure('sequit:canvas-projection', {
					start,
					end: performance.now(),
				});
			}
		} catch (cause) {
			if (
				activeLayoutRequest === request &&
				revision === projectionRevision &&
				current === openedDocument
			) {
				previousProjectionRevision = -1;
				previousMeasurementSignature = '';
				if (cause instanceof SourceDocumentProjectionError)
					display = { kind: 'invalid-source', state: cause.state };
				else if (cause instanceof LayoutProjectionError && cause.regions !== undefined)
					display = {
						kind: 'partial',
						diagnostic: cause.diagnostic,
						regions: cause.regions,
					};
				else
					display = {
						kind: 'diagnostic',
						diagnostic: cause instanceof LayoutProjectionError ? cause.diagnostic : undefined,
					};
				session.clearSelection();
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

	function sourceDiagnosticKey(diagnostic: InvalidSourceDocumentState['diagnostics'][number]) {
		return `${diagnostic.code}:${diagnostic.path.join('/')}`;
	}

	function sortedSourceDiagnostics(state: InvalidSourceDocumentState) {
		return [...state.diagnostics].sort((a, b) =>
			compareCanonicalStrings(sourceDiagnosticKey(a), sourceDiagnosticKey(b)),
		);
	}

	function handleWheel(event: WheelEvent) {
		if ((!event.ctrlKey && !event.metaKey) || !viewport) return;
		event.preventDefault();
		const bounds = viewport.getBoundingClientRect();
		pendingZoomAnchor = {
			x: event.clientX - bounds.left,
			y: event.clientY - bounds.top,
		};
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
		const revision = projectionRevision;
		activeLayoutRequest = undefined;
		if (
			!layer ||
			currentMeasurementModel === undefined ||
			currentMeasurementModel !== measurementModel
		)
			return;

		let cancelled = false;
		let frame: number | undefined;
		const resizeObserver = new ResizeObserver(() => {
			scheduleRecalculation();
		});
		const observeMeasuredElements = () => {
			resizeObserver.disconnect();
			for (const element of layer.querySelectorAll<HTMLElement>(
				'[data-measure-node], [data-measure-group], [data-measure-junction]',
			)) {
				resizeObserver.observe(element);
			}
		};
		const scheduleRecalculation = () => {
			if (cancelled || frame !== undefined) return;
			frame = requestAnimationFrame(() => {
				frame = undefined;
				void tick().then(async () => {
					if (!cancelled) await recalculate(current, revision);
				});
			});
		};
		const mutationObserver = new MutationObserver(() => {
			observeMeasuredElements();
			scheduleRecalculation();
		});

		observeMeasuredElements();
		mutationObserver.observe(layer, {
			childList: true,
			subtree: true,
			characterData: true,
		});
		scheduleRecalculation();
		void document.fonts.ready.then(scheduleRecalculation);

		return () => {
			cancelled = true;
			activeLayoutRequest = undefined;
			if (frame !== undefined) cancelAnimationFrame(frame);
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
		data-canvas-revision={acceptedRevision}
		tabindex="-1"
		bind:this={viewport}
		onwheel={handleWheel}
		onpointerdown={startPanning}
		onpointermove={continuePanning}
		onpointerup={finishPanning}
		onpointercancel={finishPanning}
		onclick={handleBackgroundClick}
	>
		{#if display.kind === 'ready'}
			<RenderedCanvas canvas={display.canvas} zoom={session.zoom} {session} {onGroupEdit} />
		{:else if display.kind === 'invalid-source'}
			<section
				role="alert"
				data-source-diagnostic
				data-source-revision={display.state.revision}
				class="m-8 max-w-xl rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900"
			>
				<h2 class="font-semibold">Document source invalide</h2>
				<p>La vue du document courant ne peut pas être calculée.</p>
				<p data-document-id={display.state.snapshot.id}>
					{display.state.snapshot.title ?? 'Titre indisponible'} · {display.state.snapshot.id ??
						'ID indisponible'}
					· {display.state.snapshot.layoutDirection ?? 'Direction indisponible'}
				</p>
				<ul class="mt-2 list-inside list-disc">
					<li>
						Nœuds ({display.state.snapshot.nodeIds.length}) : {display.state.snapshot.nodeIds.join(
							', ',
						)}
					</li>
					<li>
						Groupes ({display.state.snapshot.groupIds.length}) : {display.state.snapshot.groupIds.join(
							', ',
						)}
					</li>
					<li>
						Jonctions ({display.state.snapshot.junctionIds.length}) : {display.state.snapshot.junctionIds.join(
							', ',
						)}
					</li>
					<li>
						Relations ({display.state.snapshot.relationIds.length}) : {display.state.snapshot.relationIds.join(
							', ',
						)}
					</li>
					<li>
						Lanes ({display.state.snapshot.laneIds.length}) : {display.state.snapshot.laneIds.join(
							', ',
						)}
					</li>
				</ul>
				<ul aria-label="Diagnostics du document" class="mt-2 list-inside list-disc">
					{#each sortedSourceDiagnostics(display.state) as diagnostic, index (index)}
						<li data-source-diagnostic-code={diagnostic.code}>
							{diagnostic.code} · {diagnostic.path.join(' / ') || 'document'}
						</li>
					{/each}
				</ul>
			</section>
		{:else if display.kind === 'diagnostic' || display.kind === 'partial'}
			<section
				role="alert"
				data-layout-diagnostic
				class="m-8 max-w-5xl rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900"
			>
				<h2 class="font-semibold">Échec du calcul de mise en page</h2>
				<p>Le document courant est conservé. Sa géométrie complète ne peut pas être affichée.</p>
				{#if display.diagnostic}
					<p
						data-layout-reason={display.diagnostic.reason.code}
						data-layout-relation-id={display.diagnostic.reason.relationId}
					>
						{display.diagnostic.reason.message}
					</p>
					<p data-document-id={display.diagnostic.documentId}>
						{display.diagnostic.title} · {display.diagnostic.documentId} · {display.diagnostic
							.direction}
					</p>
					<ul class="mt-2 list-inside list-disc">
						<li>
							Nœuds ({display.diagnostic.nodeIds.length}) : {display.diagnostic.nodeIds.join(', ')}
						</li>
						<li>
							Groupes ({display.diagnostic.groupIds.length}) : {display.diagnostic.groupIds.join(
								', ',
							)}
						</li>
						<li>
							Jonctions ({display.diagnostic.junctionIds.length}) : {display.diagnostic.junctionIds.join(
								', ',
							)}
						</li>
						<li>
							Relations ({display.diagnostic.relationIds.length}) : {display.diagnostic.relationIds.join(
								', ',
							)}
						</li>
					</ul>
				{/if}
				{#if display.kind === 'partial'}
					<p class="mt-3">Aperçus locaux calculés avec le document et les mesures courants.</p>
					<div class="mt-3 grid gap-3 md:grid-cols-2" data-partial-regions>
						{#each display.regions as region (region.regionId)}
							<article
								class="rounded-md border border-stone-300 bg-white p-3 text-stone-900"
								data-partial-region-id={region.regionId}
								data-partial-region-status={region.kind}
							>
								<h3 class="font-semibold">Région {region.regionId}</h3>
								{#if region.kind === RegionPreviewKind.Ready}
									<RegionPartialPreview canvas={region.canvas} />
								{:else}
									<p data-partial-region-reason={region.code}>{region.message}</p>
								{/if}
							</article>
						{/each}
					</div>
				{/if}
			</section>
		{:else}
			<p class="m-8 text-sm text-stone-500">Measuring document…</p>
		{/if}
	</div>

	{#if display.kind === 'ready' || display.kind === 'measuring'}
		<CanvasOverlay
			{canvas}
			viewportElement={viewport}
			{session}
			{editor}
			{awareness}
			{hideToolbar}
			{onGroup}
			{onGroupEdit}
			{onDelete}
		/>
	{/if}
</div>

<style>
	.canvas-grid {
		background-color: #f5f5f4;
		background-image: radial-gradient(#d6d3d1 0.8px, transparent 0.8px);
		background-size: 20px 20px;
	}
</style>
