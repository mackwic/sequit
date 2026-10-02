<svelte:head>
	<title>Signalements de layout · Sequit</title>
	<meta name="robots" content="noindex" />
</svelte:head>

{#if import.meta.env.DEV}
	{#await import('../../../app/workshop/layout-reports/LayoutReportsPage.svelte') then page}
		<page.default />
	{/await}
{/if}
