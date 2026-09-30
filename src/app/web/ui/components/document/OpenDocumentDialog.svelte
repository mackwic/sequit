<script lang="ts">
	import { onMount, tick } from 'svelte';

	import { openDocument,type OpenDocumentResult } from '../../../projection/open-document';
	import Icon from '../ui/Icon.svelte';
	import ModalDialog from '../ui/ModalDialog.svelte';

	type Diagnostics = Extract<OpenDocumentResult, { ok: false }>['diagnostics'];

	let { onopen, onclose }: { onopen: (source: string) => void; onclose: () => void } = $props();
	const inputId = $props.id();
	let input = $state<HTMLInputElement>();
	let filename = $state('');
	let diagnostics = $state<Diagnostics>([]);
	// A file read finishing after Annuler, or after a newer selection, must not replace the document.
	let alive = true;
	let request = 0;

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

	function location(diagnostic: Diagnostics[number]): string {
		if (diagnostic.line === undefined) return diagnostic.path.join('.');
		return `ligne ${diagnostic.line}`;
	}
</script>

<ModalDialog
	title="Ouvrir un document"
	description="Le document courant est remplacé sans être enregistré ; exporte-le d’abord si tu veux le conserver."
	{onclose}
>
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
		<div class="ui-notice error" role="alert">
			<Icon name="phosphor:warning-circle" />
			<div>
				<p class="m-0 font-semibold">{filename} n’est pas un document Sequit valide.</p>
				<ul class="m-0 mt-1 list-disc pl-5">
					{#each diagnostics as diagnostic, index (index)}
						<li>{diagnostic.message} <span class="opacity-70">({location(diagnostic)})</span></li>
					{/each}
				</ul>
			</div>
		</div>
	{/if}
	{#snippet footer()}
		<button class="ui-action" type="button" onclick={onclose}>
			<Icon name="phosphor:x" /> Annuler
		</button>
	{/snippet}
</ModalDialog>
