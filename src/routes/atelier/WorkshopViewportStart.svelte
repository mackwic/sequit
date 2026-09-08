<script lang="ts">
	import type { CanvasModel } from '$lib/canvas/canvas-model';

	let {
		canvas,
		viewport,
	}: { canvas: CanvasModel | undefined; viewport: HTMLDivElement | undefined } = $props();
	let positioned = false;
	$effect(() => {
		if (positioned || !canvas || !viewport) return;
		const node = viewport.querySelector<HTMLElement>('[data-node-id]');
		if (!node) return;
		positioned = true;
		const area = viewport.getBoundingClientRect();
		const bounds = node.getBoundingClientRect();
		if (
			bounds.left >= area.left &&
			bounds.right <= area.right &&
			bounds.top >= area.top &&
			bounds.bottom <= area.bottom
		)
			return;
		viewport.scrollBy({
			left: bounds.x + bounds.width / 2 - area.x - area.width / 2,
			top: bounds.y - area.y - 32,
			behavior: 'instant',
		});
	});
</script>
