<script lang="ts">
	import { entityKey, EntityKind, entityRef } from '../../canvas/canvas-entity';
	import type { RenderedCanvasNode, UnpositionedCanvasNode } from '../../canvas/canvas-model';
	import type { CanvasSession } from '../../session/canvas-session.svelte';
	import NodeContent from './NodeContent.svelte';

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
	let color = $derived(node.color ?? node.nature.color);
	let icon = $derived(node.icon ?? node.nature.icon ?? 'none');
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
			if ('bounds' in node) session.beginNodeMarkdownEdit(node);
		}
	}

	function handleDoubleClick(event: MouseEvent) {
		if (!session || !ref || !('bounds' in node)) return;
		event.preventDefault();
		event.stopPropagation();
		session.selectEntity(ref);
		session.beginNodeMarkdownEdit(node);
	}
	function pixels(value: number | undefined): string | undefined {
		if (value === undefined) return undefined;
		return `${value}px`;
	}
</script>

{#if measuring}
	<article
		class="node-card"
		data-measure-node={measurementId}
		style:--content-color={color}
		style:width="220px"
	>
		<NodeContent label={node.nature.label} markdown={node.markdown} {icon} />
	</article>
{:else}
	<button
		class="node-card positioned"
		class:selected
		type="button"
		tabindex={tabIndex}
		data-node-id={nodeId}
		data-content-icon={icon}
		data-content-color={color}
		data-canvas-entity-key={canvasEntityKey}
		style:--content-color={color}
		style:width={pixels(bounds?.width)}
		style:left={pixels(bounds?.x)}
		style:top={pixels(bounds?.y)}
		style:height={pixels(bounds?.height)}
		aria-label={`${node.nature.label}: ${node.markdown}`}
		aria-pressed={selected}
		onclick={handleClick}
		ondblclick={handleDoubleClick}
		onkeydown={handleKeyDown}
	>
		<NodeContent label={node.nature.label} markdown={node.markdown} {icon} />
	</button>
{/if}

<style>
	.node-card {
		display: block;
		box-sizing: border-box;
		border: 1px solid color-mix(in srgb, var(--content-color) 35%, #d6d3d1);
		border-radius: 0.75rem;
		padding: 0;
		text-align: left;
		background: var(--content-surface);
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
		outline: 3px solid var(--ui-accent);
		outline-offset: 2px;
	}

	.positioned:focus-visible {
		outline: 2px dashed var(--ui-accent);
		outline-offset: 7px;
	}

	@media print {
		.node-card {
			box-shadow: none;
			border-color: #666;
		}
		.positioned.selected,
		.positioned:focus-visible {
			outline: none;
		}
	}
</style>
