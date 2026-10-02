<script lang="ts">
	import type { Snippet } from 'svelte';

	import { entityKey, EntityKind, entityRef } from '../../canvas/canvas-entity';
	import {
		activateEntityByKeyboard,
		activateEntityByPointer,
	} from '../../canvas/canvas-entity-events';
	import type { RenderedCanvasNode, UnpositionedCanvasNode } from '../../canvas/canvas-model';
	import type { CanvasSession } from '../../session/canvas-session.svelte';
	import NodeContent from './NodeContent.svelte';

	let {
		node,
		measuring = false,
		session,
		tabbable = false,
		ontype,
		body,
		label = '',
		element = $bindable(),
	}: {
		node: RenderedCanvasNode | UnpositionedCanvasNode;
		measuring?: boolean;
		session?: CanvasSession;
		tabbable?: boolean;
		/** Types the box in place on double-click or Enter; without it, they open its dialog. */
		ontype?: ((node: RenderedCanvasNode) => void) | undefined;
		/** A box being typed in place: its body is this editor. */
		body?: Snippet | undefined;
		/** Accessible name of a box being typed. */
		label?: string;
		element?: HTMLElement | undefined;
	} = $props();
	let color = $derived(node.color ?? node.nature.color);
	let icon = $derived(node.icon ?? node.nature.icon ?? 'none');
	let bounds = $derived.by(() => {
		if ('bounds' in node) return node.bounds;
		return undefined;
	});
	function pixels(value: number | undefined): string | undefined {
		if (value === undefined) return undefined;
		return `${value}px`;
	}
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
	let nodeGroupId = $derived.by(() => {
		if (!('navigation' in node)) return undefined;
		return node.navigation.groupId;
	});
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
		activateEntityByPointer(session, ref, event);
	}

	/** Double-click and Enter type the box in place where the canvas allows it, else open its dialog. */
	function edit(rendered: RenderedCanvasNode): void {
		if (ontype !== undefined) ontype(rendered);
		else session?.beginNodeEdit(rendered);
	}

	function handleKeyDown(event: KeyboardEvent) {
		if (!session || !ref) return;
		if (!activateEntityByKeyboard(session, ref, event)) return;
		if (event.code === 'Enter' && 'bounds' in node) edit(node);
	}

	/** On the header, where the nature is, a double-click opens the box's properties. */
	function handleDoubleClick(event: MouseEvent) {
		if (!session || !ref || !('bounds' in node)) return;
		event.preventDefault();
		event.stopPropagation();
		session.selectEntity(ref);
		if (event.target instanceof Element && event.target.closest('[data-node-header]') !== null)
			session.beginNodeEdit(node);
		else edit(node);
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
{:else if body}
	<div
		class="node-card positioned draft"
		role="group"
		aria-label={label}
		data-node-draft={node.id}
		style:--content-color={color}
		style:width={pixels(bounds?.width)}
		style:left={pixels(bounds?.x)}
		style:top={pixels(bounds?.y)}
		style:height={pixels(bounds?.height)}
		bind:this={element}
	>
		<NodeContent label={node.nature.label} markdown="" {icon} {body} />
	</div>
{:else}
	<button
		class="node-card positioned"
		class:selected
		type="button"
		tabindex={tabIndex}
		data-node-id={nodeId}
		data-node-group-id={nodeGroupId}
		data-endpoint-id={nodeId}
		data-content-icon={icon}
		data-content-color={color}
		data-canvas-entity-key={canvasEntityKey}
		style:--content-color={color}
		style:width={pixels(bounds?.width)}
		style:left={pixels(bounds?.x)}
		style:top={pixels(bounds?.y)}
		style:height={pixels(bounds?.height)}
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

	/* The layout may make a box taller than its content (port room on a face): the header stays at
	   the top, where a button would otherwise centre its content. */
	.positioned {
		position: absolute;
		z-index: 20;
		display: flex;
		flex-direction: column;
		justify-content: flex-start;
		overflow: hidden;
		outline: 3px solid transparent;
		outline-offset: 2px;
		transition-property:
			left, top, width, height, opacity, transform, border-color, background-color, box-shadow,
			outline-color;
		transition-duration: var(--canvas-motion-duration);
		transition-timing-function: var(--canvas-motion-easing);
	}

	@starting-style {
		.positioned {
			opacity: 0;
			transform: scale(0.96);
		}
	}

	.positioned.selected,
	.positioned.draft {
		outline-color: var(--ui-accent);
	}

	/* An exported picture shows no selection. */
	:global([data-exporting]) .positioned.selected {
		outline-color: transparent;
	}

	.positioned:focus-visible {
		outline: 2px dashed var(--ui-accent);
		outline-offset: 7px;
	}

	@media print {
		.node-card {
			box-shadow: none;
		}
		.positioned.selected,
		.positioned:focus-visible {
			outline: none;
		}
	}
</style>
