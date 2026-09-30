<script lang="ts">
	import type { CanvasSession } from '../../session/canvas-session.svelte';
	import Icon from '../ui/Icon.svelte';

	let { session }: { session: CanvasSession } = $props();
</script>

<div
	class="absolute right-4 bottom-4 z-20 flex items-center gap-1 rounded-lg border border-[var(--ui-border)] bg-[var(--ui-surface)] p-1 shadow-sm"
	role="group"
	aria-label="Zoom du canvas"
>
	<button
		class="ui-action quiet"
		type="button"
		aria-label="Zoom arrière"
		disabled={!session.canZoomOut}
		onclick={() => session.zoomOut()}
	>
		<Icon name="phosphor:minus" />
	</button>
	<button
		class="ui-action quiet min-w-12"
		type="button"
		aria-label="Réinitialiser le zoom"
		title="Revenir à 100 %"
		onclick={() => session.resetZoom()}
	>
		{session.zoomPercentage}%
	</button>
	<button
		class="ui-action quiet"
		type="button"
		aria-label="Zoom avant"
		disabled={!session.canZoomIn}
		onclick={() => session.zoomIn()}
	>
		<Icon name="phosphor:plus" />
	</button>
</div>
