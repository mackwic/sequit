<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';

	import type { LogicNature } from '../../../../../lib/core/document/logic-document';
	import SharedEditDialog from './SharedEditDialog.svelte';

	let {
		natures,
		connected,
		oncreate,
		onclose,
	}: {
		natures: readonly LogicNature[];
		connected: boolean;
		oncreate: (natureId: string, markdown: string) => void;
		onclose: () => void;
	} = $props();
	let natureId = $state(untrack(() => natures[0]?.id ?? ''));
	let markdown = $state('');
	let content: HTMLTextAreaElement;
	onMount(() => {
		void tick().then(() => {
			content.focus();
		});
	});
</script>

<SharedEditDialog
	label="Nouvelle boîte"
	description="Choisissez sa nature et son contenu. Le graphe placera la boîte automatiquement."
	{onclose}
>
	<form
		onsubmit={(event) => {
			event.preventDefault();
			if (connected && natures.some((nature) => nature.id === natureId))
				oncreate(natureId, markdown);
		}}
	>
		<label>Contenu<textarea bind:this={content} bind:value={markdown} rows="5"></textarea></label>
		<label
			>Nature<select bind:value={natureId}
				>{#each natures as nature (nature.id)}<option value={nature.id}>{nature.label}</option
					>{/each}</select
			></label
		>
		{#if natures.length === 0}<p>Ajoutez d’abord une nature au document.</p>{/if}
		<button type="button" onclick={onclose}>Annuler</button>
		<button type="submit" disabled={!connected || !natures.some((nature) => nature.id === natureId)}
			>Créer</button
		>
	</form>
</SharedEditDialog>

<style>
	label {
		display: grid;
		gap: 6px;
		margin-bottom: 16px;
	}
	textarea,
	select,
	button {
		padding: 8px 12px;
		border: 1px solid #d6d3d1;
		border-radius: 6px;
		background: white;
	}
	textarea {
		resize: vertical;
	}
	button {
		margin-right: 8px;
		cursor: pointer;
	}
</style>
