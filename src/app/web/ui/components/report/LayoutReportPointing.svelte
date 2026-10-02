<script lang="ts">
	import { m } from '../../../i18n/paraglide/messages';
	import type { Point } from '../../../projection/layout-graph';
	import type { CanvasModel } from '../../canvas/canvas-model';
	import {
		entitiesInZone,
		entityAt,
		type ReportZone,
		zoneBetween,
	} from '../../report/report-zones';

	/** Below this many screen pixels, a drag is a click on what lies under it. */
	const CLICK_DISTANCE = 4;
	/** How far from a route, in screen pixels, a click still points at it. */
	const ROUTE_TOLERANCE = 6;

	let {
		canvas,
		viewport,
		zones,
		onzone,
		ondone,
	}: {
		canvas: CanvasModel;
		viewport: HTMLElement;
		zones: readonly ReportZone[];
		onzone: (zone: ReportZone) => void;
		ondone: () => void;
	} = $props();
	let overlay = $state<HTMLDivElement>();
	/** Where the stage's origin sits in the overlay, and its zoom. */
	let frame = $state({ x: 0, y: 0, zoom: 1 });
	let drawing = $state<{ from: Point; to: Point; pointerId: number }>();
	let preview = $derived(drawing && zoneBetween(drawing.from, drawing.to));

	$effect(() => {
		const element = overlay;
		const width = canvas.width;
		if (element === undefined) return;
		const measure = (): void => {
			const stage = viewport.querySelector('[data-graph-stage]');
			if (stage === null || width <= 0) return;
			const rect = stage.getBoundingClientRect();
			const own = element.getBoundingClientRect();
			frame = { x: rect.left - own.left, y: rect.top - own.top, zoom: rect.width / width };
		};
		measure();
		const resize = new ResizeObserver(measure);
		resize.observe(viewport);
		viewport.addEventListener('scroll', measure);
		return () => {
			resize.disconnect();
			viewport.removeEventListener('scroll', measure);
		};
	});

	function canvasPoint(event: PointerEvent): Point {
		const own = overlay?.getBoundingClientRect();
		const left = own?.left ?? 0;
		const top = own?.top ?? 0;
		return {
			x: (event.clientX - left - frame.x) / frame.zoom,
			y: (event.clientY - top - frame.y) / frame.zoom,
		};
	}

	function start(event: PointerEvent): void {
		if (event.button !== 0 || !(event.target instanceof Element)) return;
		if (event.target.closest('[data-pointing-bar]') !== null) return;
		event.preventDefault();
		event.stopPropagation();
		overlay?.setPointerCapture(event.pointerId);
		const point = canvasPoint(event);
		drawing = { from: point, to: point, pointerId: event.pointerId };
	}

	function move(event: PointerEvent): void {
		if (drawing?.pointerId !== event.pointerId) return;
		drawing = { ...drawing, to: canvasPoint(event) };
	}

	function finish(event: PointerEvent): void {
		const current = drawing;
		if (current?.pointerId !== event.pointerId) return;
		drawing = undefined;
		event.stopPropagation();
		const bounds = zoneBetween(current.from, current.to);
		const extent = Math.max(bounds.width, bounds.height) * frame.zoom;
		if (extent >= CLICK_DISTANCE) {
			onzone({ bounds, entities: entitiesInZone(canvas, bounds) });
			return;
		}
		const pointed = entityAt(canvas, current.from, ROUTE_TOLERANCE / frame.zoom);
		if (pointed !== undefined) onzone({ bounds: pointed.bounds, entities: [pointed.ref] });
	}

	function scroll(event: WheelEvent): void {
		event.preventDefault();
		viewport.scrollBy({ left: event.deltaX, top: event.deltaY });
	}

	function keydown(event: KeyboardEvent): void {
		if (event.key !== 'Escape') return;
		event.preventDefault();
		event.stopPropagation();
		ondone();
	}
</script>

<svelte:window onkeydowncapture={keydown} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="pointing"
	data-layout-report-pointing
	aria-label={m.feedback_pointing_aria()}
	bind:this={overlay}
	onpointerdown={start}
	onpointermove={move}
	onpointerup={finish}
	onpointercancel={() => {
		drawing = undefined;
	}}
	onwheel={scroll}
>
	{#each zones as zone, index (index)}
		<div
			class="zone"
			data-report-zone={index}
			aria-label={m.feedback_zone_label({ index: index + 1 })}
			style:left={`${frame.x + zone.bounds.x * frame.zoom}px`}
			style:top={`${frame.y + zone.bounds.y * frame.zoom}px`}
			style:width={`${zone.bounds.width * frame.zoom}px`}
			style:height={`${zone.bounds.height * frame.zoom}px`}
		>
			<span>{index + 1}</span>
		</div>
	{/each}
	{#if preview}
		<div
			class="zone drawing"
			aria-hidden="true"
			style:left={`${frame.x + preview.x * frame.zoom}px`}
			style:top={`${frame.y + preview.y * frame.zoom}px`}
			style:width={`${preview.width * frame.zoom}px`}
			style:height={`${preview.height * frame.zoom}px`}
		></div>
	{/if}
	<div class="bar" data-pointing-bar role="status">
		<span>{m.feedback_pointing_hint()}</span>
		<strong>
			{#if zones.length === 0}{m.feedback_zones_none()}{:else}{m.feedback_zones_count({
					count: zones.length,
				})}{/if}
		</strong>
		<button class="ui-action primary" type="button" onclick={ondone}>
			{m.feedback_pointing_done()}
		</button>
	</div>
</div>

<style>
	.pointing {
		position: absolute;
		inset: 0;
		z-index: 40;
		overflow: hidden;
		cursor: crosshair;
		background: color-mix(in srgb, var(--ui-accent) 4%, transparent);
		touch-action: none;
	}
	.zone {
		position: absolute;
		border: 2px solid var(--ui-danger);
		border-radius: 6px;
		background: color-mix(in srgb, var(--ui-danger) 10%, transparent);
		pointer-events: none;
	}
	.zone.drawing {
		border-style: dashed;
	}
	.zone span {
		position: absolute;
		top: -10px;
		left: -10px;
		display: grid;
		width: 20px;
		height: 20px;
		place-items: center;
		border-radius: 999px;
		background: var(--ui-danger);
		color: white;
		font-size: 11px;
		font-weight: 700;
	}
	.bar {
		position: absolute;
		top: 16px;
		left: 50%;
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 6px 6px 6px 14px;
		border: 1px solid var(--ui-border);
		border-radius: 10px;
		background: var(--ui-surface);
		box-shadow: var(--ui-shadow);
		color: var(--ui-text);
		font-size: 13px;
		cursor: default;
		transform: translateX(-50%);
	}
	.bar strong {
		color: var(--ui-muted);
		font-weight: 600;
		white-space: nowrap;
	}
</style>
