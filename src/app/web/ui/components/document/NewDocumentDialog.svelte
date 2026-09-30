<script lang="ts">
	import Icon from '../ui/Icon.svelte';
	import ModalDialog from '../ui/ModalDialog.svelte';

	let {
		retained,
		oncreate,
		onclose,
	}: {
		/** Whether the current document is kept in this browser's recent documents. */
		retained: boolean;
		oncreate: () => void;
		onclose: () => void;
	} = $props();
	let description = $derived(newDescription(retained));

	function newDescription(kept: boolean): string {
		if (kept) return 'Le document courant reste disponible dans « Documents récents… ».';
		return 'Le document courant est remplacé sans être enregistré ; exporte-le d’abord si tu veux le conserver.';
	}
</script>

<ModalDialog title="Nouveau document" {description} {onclose} oncommit={oncreate}>
	<p class="m-0 text-sm text-[var(--ui-muted)]">
		Le nouveau document est vide et reprend les natures et la disposition du document courant.
	</p>
	{#snippet footer()}
		<button class="ui-action" type="button" onclick={onclose}>
			<Icon name="phosphor:x" /> Annuler
		</button>
		<button class="ui-action primary" type="button" onclick={oncreate}>
			<Icon name="phosphor:file-plus" /> Créer
		</button>
	{/snippet}
</ModalDialog>
