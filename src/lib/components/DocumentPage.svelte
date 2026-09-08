<script lang="ts">
	import { resolve } from '$app/paths';
	import CanvasWorkspace from '$lib/components/canvas/CanvasWorkspace.svelte';

	let { source, title }: { source: string; title: string } = $props();
</script>

<svelte:head>
	<title>Sequit — Logic canvas</title>
	<meta
		name="description"
		content="A collaborative canvas for structuring goals, preconditions and actions."
	/>
</svelte:head>

<main class="flex h-screen min-h-[36rem] flex-col overflow-hidden bg-stone-100 text-stone-950">
	<header
		class="z-20 flex h-14 shrink-0 items-center justify-between border-b border-stone-200 bg-white px-4"
	>
		<div class="flex min-w-0 items-center gap-4">
			<a
				class="flex items-center gap-2 font-semibold tracking-tight"
				href={resolve('/')}
				aria-label="Sequit home"
			>
				<span
					class="grid size-7 place-items-center rounded-lg bg-stone-950 text-sm font-bold text-white"
					>S</span
				>
				<span>Sequit</span>
			</a>
			<div class="h-5 w-px bg-stone-200"></div>
			<span class="truncate px-2 py-1 text-sm font-medium text-stone-700">
				{title}
			</span>
		</div>
	</header>

	<CanvasWorkspace {source} />
</main>
