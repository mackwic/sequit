<script lang="ts">
	import { onMount, tick } from 'svelte';

	import { openDocument, type OpenDocumentResult } from '../../../projection/open-document';
	import Icon from '../ui/Icon.svelte';
	import ModalDialog from '../ui/ModalDialog.svelte';
	import OpenDiagnostics from './OpenDiagnostics.svelte';

	type Diagnostics = Extract<OpenDocumentResult, { ok: false }>['diagnostics'];

	let {
		retained,
		onopen,
		onclose,
	}: {
		/** Whether the current document is kept in this browser's recent documents. */
		retained: boolean;
		onopen: (source: string) => void;
		onclose: () => void;
	} = $props();
	const inputId = $props.id();
	let input = $state<HTMLInputElement>();
	let filename = $state('');
	let diagnostics = $state<Diagnostics>([]);
	// A file read finishing after Annuler, or after a newer selection, must not replace the document.
	let alive = true;
	let request = 0;
	let description = $derived(openDescription(retained));

	function openDescription(kept: boolean): string {
		if (kept) return 'Le document courant reste disponible dans « Documents récents… ».';
		return 'Le document courant est remplacé sans être enregistré ; exporte-le d’abord si tu veux le conserver.';
	}

	onMount(() => {
		void tick().then(() => input?.focus());
		return () => {
			alive = false;
		};
	});

	async function chosen(event: Event): Promise<void> {
		if (!(event.target instanceof HTMLInputElement)) return;
		const file = event.target.files?.[0];
		if (!file) return;
		const ticket = ++request;
		const source = await file.text();
		if (!alive || ticket !== request) return;
		// The same pipeline as the workspace: parsing alone accepts graphs the canvas then refuses.
		const trial = openDocument(source);
		if (!trial.ok) {
			filename = file.name;
			diagnostics = trial.diagnostics;
			event.target.value = '';
			return;
		}
		trial.value.destroy();
		onopen(source);
	}
</script>

<ModalDialog title="Ouvrir un document" {description} {onclose}>
	<label class="ui-label" for={inputId}>Fichier Sequit (.sequit.toml)</label>
	<input
		class="ui-field"
		id={inputId}
		type="file"
		accept=".toml,.txt"
		bind:this={input}
		onchange={(event) => void chosen(event)}
	/>
	{#if diagnostics.length > 0}
		<OpenDiagnostics name={filename} {diagnostics} />
	{/if}
	{#snippet footer()}
		<button class="ui-action" type="button" onclick={onclose}>
			<Icon name="phosphor:x" /> Annuler
		</button>
	{/snippet}
</ModalDialog>
