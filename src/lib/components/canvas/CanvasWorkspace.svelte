<script lang="ts">
	import { openDocument } from '$lib/document/open-document';
	import { CanvasSession } from '$lib/session/canvas-session.svelte';

	import CanvasToolbar from './CanvasToolbar.svelte';
	import CanvasViewportControls from './CanvasViewportControls.svelte';
	import LogicCanvas from './LogicCanvas.svelte';

	let { source }: { source: string } = $props();
	let opened = $derived(openDocument(source));
	let session = $derived.by(() => {
		if (!opened.ok) return undefined;
		return new CanvasSession();
	});

	$effect(() => {
		const current = opened;
		if (!current.ok) return;
		return () => {
			current.value.destroy();
		};
	});
</script>

<section class="relative min-h-0 flex-1 overflow-hidden" aria-label="Logic canvas">
	{#if opened.ok && session}
		<LogicCanvas document={opened.value} {session} />
		<CanvasToolbar />
		<CanvasViewportControls {session} />
	{:else if !opened.ok}
		<div class="canvas-grid absolute inset-0 overflow-auto">
			<p class="m-8 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
				{opened.diagnostics.map(({ message }) => message).join('\n')}
			</p>
		</div>
	{/if}

	<div class="pointer-events-none absolute top-7 left-1/2 z-20 -translate-x-1/2">
		<div
			class="rounded-full border border-stone-200 bg-white px-3 py-1 text-xs font-medium text-stone-500 shadow-sm"
		>
			Auto-layout · Bottom to top
		</div>
	</div>
</section>

<style>
	.canvas-grid {
		background-color: #f5f5f4;
		background-image: radial-gradient(#d6d3d1 0.8px, transparent 0.8px);
		background-size: 20px 20px;
	}
</style>
