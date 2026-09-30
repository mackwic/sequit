<script lang="ts">
	import { type CanvasShortcut, shortcutHint } from '../../canvas/canvas-shortcuts';

	let {
		shortcut,
		announced = false,
	}: {
		shortcut: CanvasShortcut;
		/** Read only where the key is the content; a button announces it by `aria-keyshortcuts`. */
		announced?: boolean;
	} = $props();
</script>

<kbd aria-hidden={!announced}>{shortcutHint(shortcut)}</kbd>

<style>
	kbd {
		margin-inline-start: auto;
		border: 1px solid var(--ui-border);
		border-radius: 4px;
		padding: 2px 5px;
		color: var(--ui-muted);
		font: inherit;
		font-size: 11px;
		line-height: 1;
	}
	:global(.primary) > kbd {
		border-color: currentColor;
		color: inherit;
		opacity: 0.8;
	}
</style>
