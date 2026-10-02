<script lang="ts">
	import { m } from '../../../i18n/paraglide/messages';
	import { getLocale } from '../../../i18n/paraglide/runtime';
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
	const dateFormat = new Intl.DateTimeFormat(getLocale(), {
		dateStyle: 'medium',
		timeStyle: 'short',
	});

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
	title={m.document_recent_title()}
	description={m.document_recent_description()}
	{onclose}
>
	{#if !retained}
		<div class="ui-notice warning" role="status">
			<Icon name="phosphor:warning" />
			<p class="m-0">
				{m.document_recent_storage_unavailable()}
			</p>
		</div>
	{/if}
	{#if documents.length === 0}
		<p class="m-0 text-sm text-[var(--ui-muted)]">{m.document_recent_empty()}</p>
	{:else}
		<ul class="m-0 list-none p-0" aria-label={m.document_recent_list_aria()}>
			{#each documents as document (document.id)}
				<li class="flex items-center gap-3 border-b border-[var(--ui-border)] py-2 last:border-b-0">
					<div class="min-w-0 flex-1">
						<p class="m-0 truncate text-sm font-semibold">
							{label(document)}
							{#if document.id === currentId}
								<span class="font-normal text-[var(--ui-muted)]"
									>{m.document_recent_current_mark()}</span
								>
							{/if}
						</p>
						<p class="m-0 text-xs text-[var(--ui-muted)]">
							{m.document_recent_updated_at({ date: dateFormat.format(document.updatedAt) })}
						</p>
					</div>
					<button
						class="ui-action"
						type="button"
						disabled={document.id === currentId}
						aria-label={m.document_recent_open_aria({ name: label(document) })}
						onclick={() => {
							open(document);
						}}
					>
						<Icon name="phosphor:folder-open" />
						{m.document_recent_open()}
					</button>
					<button
						class="ui-action quiet"
						type="button"
						aria-label={m.document_recent_remove_aria({ name: label(document) })}
						onclick={() => {
							onforget(document.id);
						}}
					>
						<Icon name="phosphor:trash" />
						{m.document_recent_remove()}
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
			<Icon name="phosphor:x" />
			{m.common_close()}
		</button>
	{/snippet}
</ModalDialog>
