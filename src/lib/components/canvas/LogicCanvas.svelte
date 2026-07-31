<script lang="ts">
	import { onMount, tick } from 'svelte';

	import type { CanvasMeasurementModel, CanvasModel } from '$lib/canvas/canvas-model';
	import {
		collectLayoutMeasurements,
		layoutMeasurementSignature,
	} from '$lib/canvas/measure-canvas';
	import { openDocument } from '$lib/document/open-document';

	import CanvasMeasurementLayer from './CanvasMeasurementLayer.svelte';
	import RenderedCanvas from './RenderedCanvas.svelte';

	const EMPTY_MEASUREMENT_MODEL: CanvasMeasurementModel = {
		nodes: [],
		groups: [],
		junctions: [],
	};

	let { source }: { source: string } = $props();
	let opened = $derived(openDocument(source));
	let measurementModel = $derived.by(() => {
		if (opened.ok) return opened.value.measurementModel;
		return EMPTY_MEASUREMENT_MODEL;
	});
	let measurementLayer = $state<HTMLDivElement>();
	let canvas = $state<CanvasModel>();
	let error = $state<string>();
	let previousMeasurementSignature = '';
	let activeLayoutRequest: object | undefined;

	$effect(() => {
		error = undefined;
		if (!opened.ok) error = opened.diagnostics.map(({ message }) => message).join('\n');
		canvas = undefined;
		previousMeasurementSignature = '';
		activeLayoutRequest = undefined;
	});

	async function recalculate() {
		const layer = measurementLayer;
		if (!opened.ok || !layer) return;
		const measurements = collectLayoutMeasurements(layer);
		const signature = layoutMeasurementSignature(measurements);
		if (signature === previousMeasurementSignature) return;
		previousMeasurementSignature = signature;
		const request = {};
		activeLayoutRequest = request;
		try {
			const result = await opened.value.createCanvasModel(measurements);
			if (activeLayoutRequest === request) canvas = result;
		} catch (cause) {
			if (activeLayoutRequest === request) {
				if (cause instanceof Error) error = cause.message;
				else error = String(cause);
			}
		}
	}

	onMount(() => {
		let observer: ResizeObserver | undefined;
		void (async () => {
			await document.fonts.ready;
			await tick();
			await recalculate();
			const layer = measurementLayer;
			if (!layer) return;
			observer = new ResizeObserver(() => void recalculate());
			for (const element of layer.querySelectorAll<HTMLElement>(
				'[data-measure-node], [data-measure-group], [data-measure-junction]',
			)) {
				observer.observe(element);
			}
		})();
		return () => observer?.disconnect();
	});
</script>

<CanvasMeasurementLayer model={measurementModel} bind:element={measurementLayer} />

<div class="canvas-grid absolute inset-0 overflow-auto">
	{#if error}
		<p class="m-8 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</p>
	{:else if canvas}
		<RenderedCanvas {canvas} />
	{:else}
		<p class="m-8 text-sm text-stone-500">Measuring document…</p>
	{/if}
</div>

<style>
	.canvas-grid {
		background-color: #f5f5f4;
		background-image: radial-gradient(#d6d3d1 0.8px, transparent 0.8px);
		background-size: 20px 20px;
	}
</style>
