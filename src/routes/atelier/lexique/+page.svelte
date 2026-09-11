{#if import.meta.env.DEV}
	{#await import('../../../app/workshop/glossary/GlossaryPage.svelte') then page}
		<page.default />
	{/await}
{/if}
