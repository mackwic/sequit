<script lang="ts">
	import source from '../../../app/workshop/scenario.toml?raw';
	import type { PageData } from './$types';
	let { data }: { data: PageData } = $props();
</script>

{#if import.meta.env.DEV}
	{#await import('../../../app/workshop/CollaborationParticipant.svelte') then participant}
		<main><participant.default {source} room={data.room} name={data.name} /></main>
	{/await}
{/if}

<style>
	main {
		height: 100dvh;
		padding: 16px;
		background: #f5f3ef;
	}
</style>
