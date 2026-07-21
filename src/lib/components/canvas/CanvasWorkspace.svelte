<script lang="ts">
	import CanvasToolbar from './CanvasToolbar.svelte';
	import GraphPreview from './GraphPreview.svelte';
</script>

<section class="relative min-h-0 flex-1 overflow-hidden" aria-label="Logic canvas">
	<GraphPreview />
	<CanvasToolbar />

	<div class="pointer-events-none absolute top-7 left-1/2 z-20 -translate-x-1/2">
		<div
			class="rounded-full border border-stone-200 bg-white px-3 py-1 text-xs font-medium text-stone-500 shadow-sm"
		>
			Auto-layout · Left to right
		</div>
	</div>

	<div
		class="absolute right-4 bottom-4 z-20 flex items-center gap-1 rounded-lg border border-stone-200 bg-white p-1 shadow-sm"
	>
		<button
			class="grid size-8 place-items-center rounded-md text-stone-500 hover:bg-stone-100"
			type="button"
			aria-label="Zoom out"
		>
			−
		</button>
		<span class="w-12 text-center text-xs font-medium text-stone-600">100%</span>
		<button
			class="grid size-8 place-items-center rounded-md text-stone-500 hover:bg-stone-100"
			type="button"
			aria-label="Zoom in"
		>
			+
		</button>
	</div>
</section>
