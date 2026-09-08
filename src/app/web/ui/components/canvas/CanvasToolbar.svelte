<script lang="ts">
	import type { CanvasSession } from '../../session/canvas-session.svelte';
	import Icon from '../ui/Icon.svelte';

	let { session }: { session: CanvasSession } = $props();
</script>

<nav
	class="absolute top-1/2 left-4 z-20 flex -translate-y-1/2 flex-col gap-1 rounded-xl border border-stone-200 bg-white p-1.5 shadow-sm"
	aria-label="Canvas tools"
>
	<button
		class="grid size-9 place-items-center rounded-lg bg-[var(--ui-accent)] text-white"
		type="button"
		aria-label="Select"
		aria-pressed={session.selectModeActive}
		title="Select"
	>
		<Icon name="phosphor:cursor" />
	</button>
</nav>
