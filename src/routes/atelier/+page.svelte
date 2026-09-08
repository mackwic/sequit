<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

{#if import.meta.env.DEV}
	{#await import('../../app/workshop/WorkshopPage.svelte') then page}
		<page.default fixture={data.fixture} />
	{/await}
{/if}
