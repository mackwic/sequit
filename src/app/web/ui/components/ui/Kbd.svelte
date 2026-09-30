<script lang="ts">
	import { type CanvasShortcut, shortcutCaps, shortcutWords } from '../../canvas/canvas-shortcuts';

	let {
		shortcut,
		announced = false,
	}: {
		shortcut: CanvasShortcut;
		/** Read only where the key is the content; a button announces it by `aria-keyshortcuts`. */
		announced?: boolean;
	} = $props();
</script>

<span class="keys">
	<span class="caps" aria-hidden="true">
		{#each shortcutCaps(shortcut) as cap, index (index)}<kbd>{cap}</kbd>{/each}
	</span>
	{#if announced}<span class="sr-only">{shortcutWords(shortcut)}</span>{/if}
</span>

<style>
	.keys {
		display: inline-flex;
		margin-inline-start: auto;
		padding-inline-start: 2px;
	}
	.caps {
		display: inline-flex;
		gap: 3px;
	}
	kbd {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 20px;
		height: 20px;
		padding: 0 5px;
		border: 1px solid var(--ui-border);
		border-bottom-width: 2px;
		border-radius: 5px;
		background: var(--ui-surface);
		color: var(--ui-muted);
		font: inherit;
		font-size: 11px;
		font-weight: 500;
		line-height: 1;
		font-variant-numeric: tabular-nums;
	}
	:global(.primary) kbd {
		border-color: color-mix(in srgb, currentColor 45%, transparent);
		background: color-mix(in srgb, currentColor 12%, transparent);
		color: inherit;
	}
</style>
