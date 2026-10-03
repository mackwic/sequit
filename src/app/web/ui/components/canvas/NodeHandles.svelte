<script lang="ts">
	import { autoUpdate, computePosition, offset } from '@floating-ui/dom';

	import { m } from '../../../i18n/paraglide/messages';
	import {
		CANVAS_SHORTCUTS,
		CanvasShortcutId,
		shortcutKeyshortcuts,
		shortcutTitle,
	} from '../../canvas/canvas-shortcuts';
	import type { HandleSide, HandleSides } from '../../canvas/node-handles';
	import Icon from '../ui/Icon.svelte';

	let {
		anchor,
		nodeId,
		sides,
		child,
		sibling,
	}: {
		/** The selected box, whose edges carry the handles. */
		anchor: HTMLElement;
		nodeId: string;
		sides: HandleSides;
		child: () => void;
		sibling: () => void;
	} = $props();
	/** Diameter of a handle; its centre sits on the selection outline, just outside the box. */
	const SIZE = 24;
	const OUTLINE = 4;
	const childShortcut = CANVAS_SHORTCUTS[CanvasShortcutId.CreateChild];
	const siblingShortcut = CANVAS_SHORTCUTS[CanvasShortcutId.CreateSibling];
	let childHandle = $state<HTMLButtonElement>();
	let siblingHandle = $state<HTMLButtonElement>();

	/** Keeps `handle` astride the middle of `side`, following the box through scroll and zoom. */
	function follow(handle: HTMLButtonElement | undefined, side: HandleSide) {
		if (handle === undefined) return undefined;
		const reference = anchor;
		let active = true;
		const stop = autoUpdate(
			reference,
			handle,
			() => {
				void computePosition(reference, handle, {
					strategy: 'fixed',
					placement: side,
					middleware: [offset(OUTLINE - SIZE / 2)],
				}).then(({ x, y }) => {
					if (!active) return;
					handle.style.left = `${x}px`;
					handle.style.top = `${y}px`;
				});
			},
			{ animationFrame: true },
		);
		return () => {
			active = false;
			stop();
		};
	}
	$effect(() => follow(childHandle, sides.child));
	$effect(() => follow(siblingHandle, sides.sibling));
</script>

<button
	class="node-handle"
	type="button"
	data-node-handle="child"
	aria-label={m.editing_context_create_child_aria({ id: nodeId })}
	aria-keyshortcuts={shortcutKeyshortcuts(childShortcut)}
	title={shortcutTitle(childShortcut)}
	style:--handle-size={`${SIZE}px`}
	bind:this={childHandle}
	onclick={child}><Icon name="phosphor:plus" size={14} /></button
>
<button
	class="node-handle"
	type="button"
	data-node-handle="sibling"
	aria-label={m.editing_context_create_sibling_aria({ id: nodeId })}
	aria-keyshortcuts={shortcutKeyshortcuts(siblingShortcut)}
	title={shortcutTitle(siblingShortcut)}
	style:--handle-size={`${SIZE}px`}
	bind:this={siblingHandle}
	onclick={sibling}><Icon name="phosphor:plus" size={14} /></button
>

<style>
	.node-handle {
		position: fixed;
		z-index: 35;
		display: inline-flex;
		width: var(--handle-size);
		height: var(--handle-size);
		align-items: center;
		justify-content: center;
		border: 1.5px solid var(--ui-accent);
		border-radius: 999px;
		padding: 0;
		background: var(--ui-surface);
		color: var(--ui-accent);
		box-shadow: var(--ui-shadow);
		cursor: pointer;
		pointer-events: auto;
		transition:
			background-color 90ms ease-out,
			color 90ms ease-out,
			transform 90ms ease-out;
	}
	.node-handle:hover,
	.node-handle:focus-visible {
		background: var(--ui-accent);
		color: var(--ui-on-accent);
		transform: scale(1.12);
	}
	.node-handle:focus-visible {
		outline: 2px solid var(--ui-accent);
		outline-offset: 2px;
	}
	@media (prefers-reduced-motion: reduce) {
		.node-handle {
			transition: none;
		}
	}
</style>
