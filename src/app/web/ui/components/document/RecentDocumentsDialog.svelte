<script lang="ts">
	import { openDocument, type OpenDocumentResult } from '../../../projection/open-document';
	import type { RecentDocument } from '../../document/recent-documents';
	import Icon from '../ui/Icon.svelte';
	import ModalDialog from '../ui/ModalDialog.svelte';
	import OpenDiagnostics from './OpenDiagnostics.svelte';

	type Diagnostics = Extract<OpenDocumentResult, { ok: false }>['diagnostics'];

	let {
		documents,
		currentId,
		retained,
		onopen,
		onforget,
		onclose,
	}: {
		documents: readonly RecentDocument[];
		currentId: string | undefined;
		/** Whether this browser's storage accepts writes. */
		retained: boolean;
		onopen: (document: RecentDocument) => void;
		onforget: (id: string) => void;
		onclose: () => void;
	} = $props();
	let refused = $state<{ readonly name: string; readonly diagnostics: Diagnostics }>();
	const dateFormat = new Intl.DateTimeFormat('fr', { dateStyle: 'medium', timeStyle: 'short' });

	function label(document: RecentDocument): string {
		return document.title || document.id;
	}

	function open(document: RecentDocument): void {
		// The same pipeline as the workspace: a stored source may no longer open.
		const trial = openDocument(document.source);
		if (!trial.ok) {
			refused = { name: label(document), diagnostics: trial.diagnostics };
			return;
		}
		trial.value.destroy();
		onopen(document);
	}
</script>

<ModalDialog
	title="Documents récents"
	description="Les documents ouverts ou modifiés dans ce navigateur, conservés sur cet appareil."
	{onclose}
>
	{#if !retained}
		<div class="ui-notice warning" role="status">
			<Icon name="phosphor:warning" />
			<p class="m-0">
				Stockage indisponible : les modifications ne sont pas conservées. Exporte le document pour
				le garder.
			</p>
		</div>
	{/if}
	{#if documents.length === 0}
		<p class="m-0 text-sm text-[var(--ui-muted)]">Aucun document récent.</p>
	{:else}
		<ul class="m-0 list-none p-0" aria-label="Documents récents">
			{#each documents as document (document.id)}
				<li class="flex items-center gap-3 border-b border-[var(--ui-border)] py-2 last:border-b-0">
					<div class="min-w-0 flex-1">
						<p class="m-0 truncate text-sm font-semibold">
							{label(document)}
							{#if document.id === currentId}
								<span class="font-normal text-[var(--ui-muted)]">(ouvert)</span>
							{/if}
						</p>
						<p class="m-0 text-xs text-[var(--ui-muted)]">
							Modifié le {dateFormat.format(document.updatedAt)}
						</p>
					</div>
					<button
						class="ui-action"
						type="button"
						disabled={document.id === currentId}
						aria-label={`Ouvrir ${label(document)}`}
						onclick={() => {
							open(document);
						}}
					>
						<Icon name="phosphor:folder-open" /> Ouvrir
					</button>
					<button
						class="ui-action quiet"
						type="button"
						aria-label={`Retirer ${label(document)}`}
						onclick={() => {
							onforget(document.id);
						}}
					>
						<Icon name="phosphor:trash" /> Retirer
					</button>
				</li>
			{/each}
		</ul>
	{/if}
	{#if refused}
		<OpenDiagnostics name={refused.name} diagnostics={refused.diagnostics} />
	{/if}
	{#snippet footer()}
		<button class="ui-action" type="button" onclick={onclose}>
			<Icon name="phosphor:x" /> Fermer
		</button>
	{/snippet}
</ModalDialog>
