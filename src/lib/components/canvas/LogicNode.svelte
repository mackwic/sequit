<script lang="ts">
	import type { RenderedCanvasNode, UnpositionedCanvasNode } from '$lib/canvas/canvas-model';

	let {
		node,
		measuring = false,
	}: { node: RenderedCanvasNode | UnpositionedCanvasNode; measuring?: boolean } = $props();
	let bounds = $derived.by(() => {
		if ('bounds' in node) return node.bounds;
		return undefined;
	});
	let nodeId = $derived.by(() => {
		if (!measuring) return node.id;
		return undefined;
	});
	let measurementId = $derived.by(() => {
		if (measuring) return node.id;
		return undefined;
	});
	function pixels(value: number | undefined): string | undefined {
		if (value === undefined) return undefined;
		return `${value}px`;
	}
</script>

<article
	class="node-card bg-white"
	class:positioned={bounds !== undefined}
	data-node-id={nodeId}
	data-measure-node={measurementId}
	style:--nature-color={node.nature.color}
	style:width={pixels(bounds?.width) ?? '220px'}
	style:left={pixels(bounds?.x)}
	style:top={pixels(bounds?.y)}
	style:height={pixels(bounds?.height)}
>
	<header>{node.nature.label}</header>
	<p>{node.markdown}</p>
</article>

<style>
	.node-card {
		box-sizing: border-box;
		border: 1px solid color-mix(in srgb, var(--nature-color) 35%, #d6d3d1);
		border-radius: 0.75rem;
		box-shadow:
			0 1px 2px rgb(28 25 23 / 0.06),
			0 8px 24px rgb(28 25 23 / 0.06);
	}

	.positioned {
		position: absolute;
		z-index: 20;
		overflow: hidden;
	}

	header {
		border-bottom: 1px solid color-mix(in srgb, var(--nature-color) 25%, white);
		background: color-mix(in srgb, var(--nature-color) 13%, white);
		padding: 0.55rem 0.75rem;
		color: color-mix(in srgb, var(--nature-color) 82%, black);
		font-size: 0.7rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}

	p {
		margin: 0;
		padding: 0.9rem 0.75rem 1rem;
		color: #292524;
		font-size: 0.875rem;
		line-height: 1.45;
		white-space: pre-wrap;
	}
</style>
