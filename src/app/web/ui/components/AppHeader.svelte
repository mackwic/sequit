<script lang="ts">
	import type { Snippet } from 'svelte';

	import { resolve } from '$app/paths';

	let { children, actions }: { children: Snippet; actions?: Snippet } = $props();
</script>

<header
	class="z-50 flex h-14 shrink-0 items-center justify-between gap-4 border-b border-[var(--ui-border)] bg-[var(--ui-surface)] px-4 print:hidden"
>
	<div class="flex min-w-0 items-center gap-4">
		<a
			class="flex items-center gap-2 rounded-md font-semibold tracking-tight focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--ui-accent)]"
			href={resolve('/')}
			aria-label="Accueil Sequit"
		>
			<span
				class="grid size-7 place-items-center rounded-lg bg-[var(--ui-text)] text-sm font-bold text-[var(--ui-surface)]"
				>S</span
			>
			<span>Sequit</span>
		</a>
		<div class="h-5 w-px bg-[var(--ui-border)]"></div>
		{@render children()}
	</div>
	{#if actions}
		<div class="flex shrink-0 items-center gap-2">
			{@render actions()}
		</div>
	{/if}
</header>
