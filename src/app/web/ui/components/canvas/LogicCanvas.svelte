<script lang="ts">
	import { type Snippet, tick, untrack } from 'svelte';

	import { compareCanonicalStrings } from '../../../../../lib/core/canonical-string';
	import type { LayoutLane, LogicNature } from '../../../../../lib/core/document/logic-document';
	import type { InvalidSourceDocumentState } from '../../../../../lib/infrastructure/collaboration/source-document-state';
	import { m } from '../../../i18n/paraglide/messages';
	import type { CanvasProjection } from '../../../projection/canvas-projection';
	import {
		type LayoutDiagnostic,
		LayoutProjectionError,
	} from '../../../projection/layout-diagnostic';
	import type { LayoutMeasurements } from '../../../projection/layout-graph';
	import { type RegionPreview, RegionPreviewKind } from '../../../projection/partial-region-layout';
	import { SourceDocumentProjectionError } from '../../../projection/source-document-diagnostic';
	import {
		createCanvasEntityIndex,
		EntityKind,
		type EntityRef,
		entityRef,
		entityRefFromKey,
	} from '../../canvas/canvas-entity';
	import { focusCanvasEntity } from '../../canvas/canvas-entity-dom';
	import {
		isEditableTarget,
		isNativeControlTarget,
		isUnmodifiedKeyboardEvent,
	} from '../../canvas/canvas-event-guard';
	import type {
		CanvasMeasurementModel,
		CanvasModel,
		RenderedCanvasNode,
	} from '../../canvas/canvas-model';
	import { CANVAS_SHORTCUTS, CanvasShortcutId } from '../../canvas/canvas-shortcuts';
	import {
		anchorPreservingScroll,
		canvasPanOffset,
		type CanvasPoint,
		type CanvasViewportGeometry,
		pannedScroll,
		panScrollPosition,
	} from '../../canvas/canvas-viewport';
	import {
		collectLayoutMeasurements,
		layoutMeasurementSignature,
	} from '../../canvas/measure-canvas';
	import type { LayoutReportRequest } from '../../report/capture-layout-report';
	import type { CanvasSession, EditingCanvasActivity } from '../../session/canvas-session.svelte';
	import LayoutReport from '../report/LayoutReport.svelte';
	import MenuSurface from '../ui/MenuSurface.svelte';
	import CanvasContextMenu from './CanvasContextMenu.svelte';
	import CanvasMeasurementLayer from './CanvasMeasurementLayer.svelte';
	import CanvasOverlay from './CanvasOverlay.svelte';
	import CanvasShortcut from './CanvasShortcut.svelte';
	import NatureMenuItems from './NatureMenuItems.svelte';
	import type { NodeDraftControls } from './node-typing.svelte';
	import RegionPartialPreview from './RegionPartialPreview.svelte';
	import RenderedCanvas from './RenderedCanvas.svelte';

	let {
		document: openedDocument,
		session,
		natures,
		lanes = [],
		draft,
		onNodeType,
		onNodeNature,
		onStart,
		editor,
		awareness,
		hideToolbar = false,
		oncanvas,
		onGroup,
		onDelete,
		onGroupEdit,
		onGroupToggle,
		onGroupDissolve,
		onJunctionEdit,
		onJunctionInsert,
		onCreateChild,
		onCreateSibling,
		onManageNatures,
		onExport,
		onExportImage,
		report,
	}: {
		document: CanvasProjection;
		session: CanvasSession;
		/** The natures offered by the box dialog. */
		natures: readonly LogicNature[];
		/** Root lanes offered by the box dialog for a top-level box. */
		lanes?: readonly LayoutLane[];
		/** The box typed in place, new or existing, if any. */
		draft?: NodeDraftControls | undefined;
		/** Types a box in place on double-click or Enter; without it, they open its dialog. */
		onNodeType?: ((node: RenderedCanvasNode) => void) | undefined;
		/** Gives a box another nature; without it, the header of the selected box opens no menu. */
		onNodeNature?: ((nodeId: string, natureId: string) => void) | undefined;
		/** Starts typing the first box; without it, an empty canvas invites nothing. */
		onStart?: (() => void) | undefined;
		hideToolbar?: boolean;
		oncanvas?: ((canvas: CanvasModel, viewport: HTMLDivElement) => void) | undefined;
		onGroup?: (() => void) | undefined;
		onDelete?: () => void;
		onGroupEdit?: (groupId: string) => void;
		onGroupToggle?: ((groupId: string) => void) | undefined;
		onGroupDissolve?: ((groupId: string) => void) | undefined;
		onJunctionEdit?: ((junctionId: string) => void) | undefined;
		/** Converges the given relations on a new junction; one relation is split in two. */
		onJunctionInsert?: ((relationIds: readonly string[]) => void) | undefined;
		onCreateChild?: ((target: EntityRef) => void) | undefined;
		/** Starts typing a sibling of the selected node; its handle and `S` need it. */
		onCreateSibling?: ((target: EntityRef) => void) | undefined;
		/** Offered by the background menu, each only when given. */
		onManageNatures?: (() => void) | undefined;
		onExport?: (() => void) | undefined;
		onExportImage?: (() => void) | undefined;
		editor?: Snippet<[EditingCanvasActivity, HTMLDivElement | undefined]> | undefined;
		awareness?: Snippet<[CanvasModel, HTMLDivElement]> | undefined;
		/** While set, the layout report dialog is open over this canvas. */
		report?: LayoutReportRequest | undefined;
	} = $props();
	let measurementModel = $state.raw<CanvasMeasurementModel>();
	/** The box whose nature menu is open, under its header. */
	let natureMenu = $state.raw<{ readonly nodeId: string; readonly header: HTMLElement }>();
	/** The menu lasts while its box stays alone in the selection and nothing is being typed. */
	let natureMenuNode = $derived.by(() => {
		const menu = natureMenu;
		const entity = session.contextualEntity;
		if (menu === undefined || onNodeNature === undefined || canvas === undefined) return undefined;
		if (entity?.kind !== EntityKind.Node || entity.id !== menu.nodeId) return undefined;
		const node = canvas.nodes.find(({ id }) => id === menu.nodeId);
		if (node === undefined) return undefined;
		return { id: node.id, natureId: node.nature.id, header: menu.header };
	});
	/** A second click on the header closes the menu it opened. */
	function toggleNatureMenu(nodeId: string, header: HTMLElement): void {
		if (natureMenuNode?.id === nodeId) natureMenu = undefined;
		else natureMenu = { nodeId, header };
	}
	function closeNatureMenu(restoreFocus: boolean): void {
		const header = natureMenu?.header;
		natureMenu = undefined;
		if (restoreFocus) header?.closest<HTMLElement>('[data-node-id]')?.focus();
	}
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
	/** The failure shown instead of a canvas, by its code. */
	let layoutFailure = $derived.by(() => {
		if (display.kind === 'invalid-source') return 'invalid-source';
		if (display.kind === 'diagnostic' || display.kind === 'partial')
			return display.diagnostic?.reason.code ?? 'layout-failed';
		return undefined;
	});
	let spacePressed = $state(false);
	let panning = $state(false);
	let panMoved = false;
	let suppressBackgroundActivation = false;
	/** Where the background menu was asked for, while it is open. */
	let menuPoint = $state<CanvasPoint>();
	let previousMeasurementSignature = '';
	let projectionRevision = $state(0);
	let acceptedRevision = $state(0);
	let previousProjectionRevision = -1;
	let activeLayoutRequest: object | undefined;
	let pendingZoomAnchor: CanvasPoint | undefined;
	let panStart:
		| {
				pointer: CanvasPoint;
				scroll: { left: number; top: number };
				pointerId: number;
		  }
		| undefined;
	/** The geometry the scroll position was last set for, while a canvas shows. */
	let shownGeometry: CanvasViewportGeometry | undefined;
	/** How far the person panned from the default framing; survives layouts, zooms and resizes. */
	let panOffset: CanvasPoint = { x: 0, y: 0 };

	/**
	 * Sets the scroll position once the stage shows a new geometry: a zoom keeps the point under its
	 * anchor, any other change keeps the pan offset, so that an unpanned stage stays centred while
	 * it fits. The pan margin is CSS, so a resize only moves the scroll position, never the layout.
	 */
	function followGeometry(): void {
		const current = viewport;
		const stage = canvas;
		const zoom = session.zoom;
		if (!current || !stage) {
			shownGeometry = undefined;
			return;
		}
		const size = { width: current.clientWidth, height: current.clientHeight };
		const next = { stage: { width: stage.width, height: stage.height }, viewport: size, zoom };
		const previous = shownGeometry;
		const anchor = pendingZoomAnchor;
		pendingZoomAnchor = undefined;
		if (previous !== undefined && JSON.stringify(previous) === JSON.stringify(next)) return;
		let scroll = pannedScroll(next, panOffset);
		if (previous !== undefined && previous.zoom !== next.zoom)
			scroll = anchorPreservingScroll({
				from: previous,
				to: next,
				anchor: anchor ?? { x: size.width / 2, y: size.height / 2 },
				scroll: pannedScroll(previous, panOffset),
			});
		shownGeometry = next;
		panOffset = canvasPanOffset(next, scroll);
		current.scrollTo(scroll.left, scroll.top);
	}

	$effect(followGeometry);

	$effect(() => {
		const current = viewport;
		if (!current) return;
		const observer = new ResizeObserver(followGeometry);
		observer.observe(current);
		return () => {
			observer.disconnect();
		};
	});

	function recordPan() {
		if (viewport && shownGeometry)
			panOffset = canvasPanOffset(shownGeometry, {
				left: viewport.scrollLeft,
				top: viewport.scrollTop,
			});
	}

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
			!isUnmodifiedKeyboardEvent(event) ||
			(!focusedHere && !hoveredWithoutControlFocus) ||
			isNativeControlTarget(event.target) ||
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
		if (isCanvasBackground(event.target) && !isNativeControlTarget(event.target))
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

	/** Every node and junction drawn; unlike an envelope, junctions are taken too. */
	function selectAll() {
		if (!canvas) return;
		session.clearSelection();
		for (const { id } of canvas.nodes) session.addEntity(entityRef(EntityKind.Node, id));
		for (const { id } of canvas.junctions) session.addEntity(entityRef(EntityKind.Junction, id));
	}

	/** The pointer, or the corner of the canvas when the menu key asked from elsewhere. */
	function menuPointOf(event: MouseEvent, area: HTMLElement): CanvasPoint {
		const bounds = area.getBoundingClientRect();
		const inside =
			event.clientX >= bounds.left &&
			event.clientX <= bounds.right &&
			event.clientY >= bounds.top &&
			event.clientY <= bounds.bottom;
		if (inside) return { x: event.clientX, y: event.clientY };
		return { x: bounds.left + 16, y: bounds.top + 16 };
	}

	/**
	 * A right-click selects the element under it, unless it is already selected, so that its bar
	 * shows; on the background it opens the canvas menu. Text fields keep the browser's menu.
	 */
	function handleContextMenu(event: MouseEvent) {
		if (isEditableTarget(event.target)) return;
		event.preventDefault();
		if (session.editing || !(event.target instanceof Element) || !viewport) return;
		const element = event.target.closest<HTMLElement | SVGElement>('[data-canvas-entity-key]');
		const key = element?.getAttribute('data-canvas-entity-key') ?? '';
		if (element && key !== '') {
			const ref = entityRefFromKey(key);
			if (!session.isSelected(ref)) session.selectEntity(ref);
			element.focus({ preventScroll: true });
			return;
		}
		if (isNativeControlTarget(event.target) || !canvas) return;
		menuPoint = menuPointOf(event, viewport);
	}

	$effect(() => {
		const target = session.focusRestorationTarget;
		const currentViewport = viewport;
		const currentCanvas = canvas;
		if (target === undefined || currentViewport === undefined || currentCanvas === undefined)
			return;
		void tick().then(() => {
			if (focusCanvasEntity(currentViewport, target)) session.completeFocusRestoration(target);
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
	/** The sizes the measurement layer gives now, which the shown canvas was laid out with. */
	function currentMeasurements(): LayoutMeasurements {
		if (measurementLayer === undefined)
			return { nodes: new Map(), junctions: new Map(), groups: new Map() };
		return collectLayoutMeasurements(measurementLayer);
	}
</script>

<svelte:window onkeydown={handleKeyDown} onkeyup={handleKeyUp} onblur={finishPanning} />
<CanvasShortcut
	shortcut={CANVAS_SHORTCUTS[CanvasShortcutId.SelectAll]}
	scopes={[viewport]}
	enabled={canvas !== undefined && session.editing === undefined}
	onactivate={selectAll}
/>

<div class="contents" bind:this={scope}>
	{#if measurementModel}
		<CanvasMeasurementLayer model={measurementModel} bind:element={measurementLayer} />
	{/if}

	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div
		class:cursor-grab={spacePressed && !panning}
		class:cursor-grabbing={panning}
		class="canvas-grid absolute inset-0 overflow-auto overscroll-contain print:static print:overflow-visible"
		role="region"
		aria-label={m.canvas_viewport()}
		data-canvas-viewport
		data-canvas-revision={acceptedRevision}
		tabindex="-1"
		bind:this={viewport}
		onscroll={recordPan}
		onwheel={handleWheel}
		onpointerdown={startPanning}
		onpointermove={continuePanning}
		onpointerup={finishPanning}
		onpointercancel={finishPanning}
		onclick={handleBackgroundClick}
		oncontextmenu={handleContextMenu}
	>
		{#if display.kind === 'ready'}
			<RenderedCanvas
				canvas={display.canvas}
				zoom={session.zoom}
				{session}
				{draft}
				{onNodeType}
				onNatureMenu={onNodeNature && toggleNatureMenu}
				{onStart}
				{onGroupEdit}
				{onGroupToggle}
				{onJunctionEdit}
				{onJunctionInsert}
			/>
		{:else if display.kind === 'invalid-source'}
			<section
				role="alert"
				data-source-diagnostic
				data-source-revision={display.state.revision}
				class="m-8 max-w-xl rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900"
			>
				<h2 class="font-semibold">{m.canvas_source_invalid()}</h2>
				<p>{m.canvas_source_invalid_body()}</p>
				<p data-document-id={display.state.snapshot.id}>
					{m.canvas_document_metadata({
						title: display.state.snapshot.title ?? m.canvas_title_unavailable(),
						id: display.state.snapshot.id ?? m.canvas_id_unavailable(),
						direction: display.state.snapshot.layoutDirection ?? m.canvas_direction_unavailable(),
					})}
				</p>
				<ul class="mt-2 list-inside list-disc">
					<li>
						{m.canvas_nodes_list({
							count: display.state.snapshot.nodeIds.length,
							ids: display.state.snapshot.nodeIds.join(', '),
						})}
					</li>
					<li>
						{m.canvas_groups_list({
							count: display.state.snapshot.groupIds.length,
							ids: display.state.snapshot.groupIds.join(', '),
						})}
					</li>
					<li>
						{m.canvas_junctions_list({
							count: display.state.snapshot.junctionIds.length,
							ids: display.state.snapshot.junctionIds.join(', '),
						})}
					</li>
					<li>
						{m.canvas_relations_list({
							count: display.state.snapshot.relationIds.length,
							ids: display.state.snapshot.relationIds.join(', '),
						})}
					</li>
					<li>
						{m.canvas_lanes_list({
							count: display.state.snapshot.laneIds.length,
							ids: display.state.snapshot.laneIds.join(', '),
						})}
					</li>
				</ul>
				<ul aria-label={m.canvas_document_diagnostics()} class="mt-2 list-inside list-disc">
					{#each sortedSourceDiagnostics(display.state) as diagnostic, index (index)}
						<li data-source-diagnostic-code={diagnostic.code}>
							{m.canvas_source_diagnostic({
								code: diagnostic.code,
								path: diagnostic.path.join(' / ') || m.canvas_document_root(),
							})}
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
				<h2 class="font-semibold">{m.canvas_layout_failure()}</h2>
				<p>{m.canvas_layout_failure_body()}</p>
				{#if display.diagnostic}
					<p
						data-layout-reason={display.diagnostic.reason.code}
						data-layout-relation-id={display.diagnostic.reason.relationId}
					>
						{display.diagnostic.reason.message}
					</p>
					<p data-document-id={display.diagnostic.documentId}>
						{m.canvas_document_metadata({
							title: display.diagnostic.title,
							id: display.diagnostic.documentId,
							direction: display.diagnostic.direction,
						})}
					</p>
					<ul class="mt-2 list-inside list-disc">
						<li>
							{m.canvas_nodes_list({
								count: display.diagnostic.nodeIds.length,
								ids: display.diagnostic.nodeIds.join(', '),
							})}
						</li>
						<li>
							{m.canvas_groups_list({
								count: display.diagnostic.groupIds.length,
								ids: display.diagnostic.groupIds.join(', '),
							})}
						</li>
						<li>
							{m.canvas_junctions_list({
								count: display.diagnostic.junctionIds.length,
								ids: display.diagnostic.junctionIds.join(', '),
							})}
						</li>
						<li>
							{m.canvas_relations_list({
								count: display.diagnostic.relationIds.length,
								ids: display.diagnostic.relationIds.join(', '),
							})}
						</li>
					</ul>
				{/if}
				{#if display.kind === 'partial'}
					<p class="mt-3">{m.canvas_partial_intro()}</p>
					<div class="mt-3 grid gap-3 md:grid-cols-2" data-partial-regions>
						{#each display.regions as region (region.regionId)}
							<article
								class="rounded-md border border-stone-300 bg-white p-3 text-stone-900"
								data-partial-region-id={region.regionId}
								data-partial-region-status={region.kind}
							>
								<h3 class="font-semibold">{m.canvas_region_heading({ id: region.regionId })}</h3>
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
			<p class="m-8 text-sm text-stone-500">{m.canvas_measuring()}</p>
		{/if}
	</div>

	{#if display.kind === 'ready' || display.kind === 'measuring'}
		<CanvasOverlay
			{canvas}
			viewportElement={viewport}
			{session}
			{natures}
			{lanes}
			{draft}
			{editor}
			{awareness}
			{hideToolbar}
			{onGroup}
			{onGroupEdit}
			{onGroupToggle}
			{onGroupDissolve}
			{onJunctionEdit}
			{onJunctionInsert}
			{onCreateChild}
			{onCreateSibling}
			{onDelete}
		/>
	{/if}
	{#if viewport}
		<CanvasContextMenu
			point={canvas && menuPoint}
			{viewport}
			{session}
			onselectall={selectAll}
			{onManageNatures}
			{onExport}
			{onExportImage}
			onclose={() => {
				menuPoint = undefined;
			}}
		/>
	{/if}
	{#if natureMenuNode && onNodeNature}
		{@const menu = natureMenuNode}
		{@const change = onNodeNature}
		<MenuSurface
			open
			label={m.canvas_nature_menu()}
			anchor={menu.header}
			owner={menu.header}
			placement="bottom-start"
			restoreFocusOnSelect
			onclose={closeNatureMenu}
		>
			<NatureMenuItems
				{natures}
				checkedId={menu.natureId}
				onselect={(natureId: string) => {
					if (natureId !== menu.natureId) change(menu.id, natureId);
				}}
			/>
		</MenuSurface>
	{/if}
	{#if report}
		<LayoutReport
			request={report}
			{canvas}
			{viewport}
			failure={layoutFailure}
			measure={currentMeasurements}
		/>
	{/if}
</div>

<style>
	/* The stage's pan margin is sized in `cqw`/`cqh` of this viewport (`RenderedCanvas`). */
	.canvas-grid {
		container-type: size;
		background-color: #f5f5f4;
		background-image: radial-gradient(#d6d3d1 0.8px, transparent 0.8px);
		background-size: 20px 20px;
	}
	@media print {
		.canvas-grid {
			container-type: normal;
			background: none;
		}
	}
</style>
