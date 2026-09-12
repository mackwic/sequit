<script lang="ts">
	import '../page.css';

	import { resolve } from '$app/paths';
</script>

<svelte:head
	><title>Assertions visuelles · Sequit</title><meta name="robots" content="noindex" /></svelte:head
>

{#if import.meta.env.DEV}
	<main class="visual-doc">
		<header>
			<a href={resolve('/atelier')}>← Atelier Sequit</a><span>ASSERTIONS VISUELLES</span>
		</header>
		{#await import('../../../../app/workshop/visual-tests/ScenarioGallery.svelte') then page}
			<page.default />
		{/await}
	</main>
{/if}
