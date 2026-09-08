<script lang="ts">
	import type { CanvasSession } from '../../session/canvas-session.svelte';

	let { session }: { session: CanvasSession } = $props();
</script>

<div class="sr-only" role="status" aria-live="polite" aria-atomic="true" data-canvas-status>
	{session.announcement}
</div>
