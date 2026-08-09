<script lang="ts">
	import { entityKey, EntityKind, entityRef } from '$lib/canvas/canvas-entity';
	import type { RenderedCanvasNode, UnpositionedCanvasNode } from '$lib/canvas/canvas-model';
	import type { CanvasSession } from '$lib/session/canvas-session.svelte';

	let {
		node,
		measuring = false,
		session,
		tabbable = false,
	}: {
		node: RenderedCanvasNode | UnpositionedCanvasNode;
		measuring?: boolean;
		session?: CanvasSession;
		tabbable?: boolean;
	} = $props();
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
	let ref = $derived.by(() => {
		if (measuring) return undefined;
		return entityRef(EntityKind.Node, node.id);
	});
	let selected = $derived(ref !== undefined && session?.isSelected(ref) === true);
	let canvasEntityKey = $derived.by(() => {
		if (ref === undefined) return undefined;
		return entityKey(ref.kind, ref.id);
	});
	let tabIndex = $derived.by(() => {
		if (tabbable) return 0;
		return -1;
	});

	function handleClick(event: MouseEvent) {
		if (!session || !ref) return;
		event.stopPropagation();
		if (event.metaKey || event.ctrlKey) session.toggleEntity(ref);
		else session.selectEntity(ref);
	}

	function handleKeyDown(event: KeyboardEvent) {
		if (!session || !ref) return;
		if (event.code === 'Space') {
			event.preventDefault();
			event.stopPropagation();
			session.toggleEntity(ref);
		} else if (event.code === 'Enter') {
			event.preventDefault();
			event.stopPropagation();
			session.selectEntity(ref);
		}
	}
	function pixels(value: number | undefined): string | undefined {
		if (value === undefined) return undefined;
		return `${value}px`;
	}
</script>

{#if measuring}
	<article
		class="node-card bg-white"
		data-measure-node={measurementId}
		style:--nature-color={node.nature.color}
		style:width="220px"
	>
		<span class="node-header">{node.nature.label}</span>
		<span class="node-body">{node.markdown}</span>
	</article>
{:else}
	<button
		class="node-card positioned bg-white"
		class:selected
		type="button"
		tabindex={tabIndex}
		data-node-id={nodeId}
		data-canvas-entity-key={canvasEntityKey}
		style:--nature-color={node.nature.color}
		style:width={pixels(bounds?.width)}
		style:left={pixels(bounds?.x)}
		style:top={pixels(bounds?.y)}
		style:height={pixels(bounds?.height)}
		aria-label={`${node.nature.label}: ${node.markdown}`}
		aria-pressed={selected}
		onclick={handleClick}
		onkeydown={handleKeyDown}
	>
		<span class="node-header">{node.nature.label}</span>
		<span class="node-body">{node.markdown}</span>
	</button>
{/if}

<style>
	.node-card {
		display: block;
		box-sizing: border-box;
		border: 1px solid color-mix(in srgb, var(--nature-color) 35%, #d6d3d1);
		border-radius: 0.75rem;
		padding: 0;
		text-align: left;
		box-shadow:
			0 1px 2px rgb(28 25 23 / 0.06),
			0 8px 24px rgb(28 25 23 / 0.06);
	}

	.positioned {
		position: absolute;
		z-index: 20;
		overflow: hidden;
	}

	.positioned.selected {
		outline: 3px solid #0c0a09;
		outline-offset: 2px;
	}

	.positioned:focus-visible {
		outline: 3px solid #0c0a09;
		outline-offset: 4px;
	}

	.node-header {
		display: block;
		border-bottom: 1px solid color-mix(in srgb, var(--nature-color) 25%, white);
		background: color-mix(in srgb, var(--nature-color) 13%, white);
		padding: 0.55rem 0.75rem;
		color: color-mix(in srgb, var(--nature-color) 82%, black);
		font-size: 0.7rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}

	.node-body {
		display: block;
		padding: 0.9rem 0.75rem 1rem;
		color: #292524;
		font-size: 0.875rem;
		line-height: 1.45;
		white-space: pre-wrap;
	}
</style>
