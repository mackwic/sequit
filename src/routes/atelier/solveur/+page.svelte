<script lang="ts">
	import { resolve } from '$app/paths';
</script>

<svelte:head>
	<title>Prototype des IR de layout · Sequit</title>
	<meta name="robots" content="noindex" />
</svelte:head>

{#if import.meta.env.DEV}
	<div class="solver-page">
		<header>
			<a href={resolve('/atelier')}>← Atelier Sequit</a>
			<span>CONTRAT SYMBOLIQUE · ATELIER</span>
		</header>
		{#await import('../../../app/workshop/visual-tests/solver-prototype/SolverExplorer.svelte') then explorer}
			<explorer.default />
		{/await}
	</div>
{/if}

<style>
	:global(body:has(.solver-page)) {
		background: #f6f5f0;
	}
	.solver-page {
		max-width: 1440px;
		margin: auto;
		padding: 2.5rem 2rem 5rem;
		color: #243e32;
		font-family: system-ui, sans-serif;
	}
	header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 1rem;
		padding-bottom: 1.5rem;
		border-bottom: 1px solid #d8ded2;
	}
	a {
		color: #416f58;
		text-underline-offset: 4px;
	}
	header span {
		font-size: 0.7rem;
		font-weight: 650;
		letter-spacing: 0.14em;
		color: #687a6c;
	}
</style>
