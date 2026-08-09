<script lang="ts">
	import type { CanvasSession } from '$lib/session/canvas-session.svelte';

	let { session }: { session: CanvasSession } = $props();
</script>

<div
	class="absolute right-4 bottom-4 z-20 flex items-center gap-1 rounded-lg border border-stone-200 bg-white p-1 shadow-sm"
	aria-label="Canvas zoom"
>
	<button
		class="grid size-8 place-items-center rounded-md text-stone-500 hover:bg-stone-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-950 disabled:cursor-not-allowed disabled:opacity-40"
		type="button"
		aria-label="Zoom out"
		disabled={!session.canZoomOut}
		onclick={() => session.zoomOut()}
	>
		−
	</button>
	<button
		class="w-12 rounded-md py-2 text-center text-xs font-medium text-stone-600 hover:bg-stone-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-950"
		type="button"
		aria-label="Reset zoom"
		title="Reset zoom to 100%"
		onclick={() => session.resetZoom()}
	>
		{session.zoomPercentage}%
	</button>
	<button
		class="grid size-8 place-items-center rounded-md text-stone-500 hover:bg-stone-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-950 disabled:cursor-not-allowed disabled:opacity-40"
		type="button"
		aria-label="Zoom in"
		disabled={!session.canZoomIn}
		onclick={() => session.zoomIn()}
	>
		+
	</button>
</div>
