<script lang="ts">
	import { untrack } from 'svelte';

	import { serializeSequitToml } from '$lib/infrastructure/toml/serialize-sequit-toml';

	import Icon from '../../web/ui/components/ui/Icon.svelte';
	import DownloadButton from '../DownloadButton.svelte';
	import type { WorkbenchToolProps } from '../workshop-types';
	let { model, workbench, presentation, report }: WorkbenchToolProps = $props();
	let title = $state(untrack(() => model.title));
	let imported = $state('');
	let opened = $state(false);
	let confirmation = $state<HTMLDialogElement>();
	let exportText = $derived(serializeSequitToml(model));
	function load() {
		try {
			workbench.import(imported);
			title = workbench.read().title;
			report('Document importé. Identifiants et contenu relus depuis le texte.');
		} catch (error) {
			report(`Import refusé : ${String(error)}. Le document courant est conservé.`, true);
		}
	}
	async function file(event: Event) {
		if (!(event.target instanceof HTMLInputElement)) return;
		const chosen = event.target.files?.[0];
		if (chosen) imported = await chosen.text();
	}
	function create() {
		workbench.commands.newDocument(`document-${crypto.randomUUID()}`);
		title = 'Sans titre';
		confirmation?.close();
		report('Nouveau document local. Recommencer restaure le document d’essai.');
	}
</script>

<div class="wb-tools">
	<h2>Document</h2>
	{#if presentation === 'menu'}<button
			type="button"
			aria-expanded={opened}
			onclick={() => {
				opened = !opened;
			}}><Icon name="phosphor:file-text" /> Actions du document</button
		>{/if}
	{#if presentation === 'sheet' || opened}
		<label>Titre du document<input bind:value={title} /></label>
		<button
			type="button"
			disabled={!title.trim()}
			onclick={() => {
				workbench.commands.renameDocument(title);
				report('Document renommé.');
			}}><Icon name="phosphor:pencil-simple" /> Renommer le document</button
		>
		<DownloadButton
			content={exportText}
			filename="atelier.sequit.toml"
			label="Exporter le document"
		/>
		<label
			>Fichier Sequit<input
				type="file"
				accept=".toml,.txt"
				onchange={(event) => void file(event)}
			/></label
		>
		<label
			>Texte à importer<textarea
				rows="5"
				bind:value={imported}
				placeholder="Coller un document .sequit.toml"></textarea></label
		>
		<button type="button" disabled={!imported.trim()} onclick={load}
			><Icon name="phosphor:upload-simple" /> Importer le texte</button
		>
		<button type="button" onclick={() => confirmation?.showModal()}
			><Icon name="phosphor:file-plus" /> Nouveau document</button
		>
	{/if}
</div>
<dialog class="wb-dialog" bind:this={confirmation} aria-labelledby="new-title">
	<h2 id="new-title">Commencer un document vide ?</h2>
	<p>
		Exporte d’abord ce que tu souhaites garder. Le document d’essai reste disponible avec
		Recommencer.
	</p>
	<div class="wb-row">
		<button type="button" onclick={() => confirmation?.close()}
			><Icon name="phosphor:x" /> Conserver le document</button
		><button type="button" onclick={create}
			><Icon name="phosphor:file-plus" /> Créer le document vide</button
		>
	</div>
</dialog>
