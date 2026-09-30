<script lang="ts">
	import { untrack } from 'svelte';

	import { resolve } from '$app/paths';

	import { serializeSequitToml } from '../../../../lib/infrastructure/toml/serialize-sequit-toml';
	import type { OpenDocumentResult } from '../../projection/open-document';
	import { documentFilename } from '../document/document-filename';
	import { downloadText } from '../document/download-text';
	import CanvasWorkspace from './canvas/CanvasWorkspace.svelte';
	import DocumentMenu from './document/DocumentMenu.svelte';
	import OpenDocumentDialog from './document/OpenDocumentDialog.svelte';

	type OpenedDocument = Extract<OpenDocumentResult, { ok: true }>['value'];
	const UNTITLED = 'Sans titre';
	let { source: initialSource }: { source: string } = $props();
	let source = $state(untrack(() => initialSource));
	let opened = $state<OpenedDocument>();
	let title = $state(UNTITLED);
	let opening = $state(false);
	// Each successful open is a new document, even when the bytes match the previous source.
	let generation = $state(0);
	let exportAction = $derived.by(() => {
		if (!opened) return undefined;
		return exportDocument;
	});
	$effect(() => {
		const current = opened;
		if (!current) {
			title = UNTITLED;
			return;
		}
		const readTitle = (): void => {
			title = current.read().title || UNTITLED;
		};
		readTitle();
		return current.subscribe(readTitle);
	});

	function exportDocument(): void {
		const current = opened;
		if (!current) return;
		const logic = current.read();
		downloadText(serializeSequitToml(logic), documentFilename(logic.title, logic.id));
	}

	function openSource(next: string): void {
		opening = false;
		opened = undefined;
		source = next;
		generation += 1;
	}
</script>

<svelte:head>
	<title>Sequit — Canvas logique</title>
	<meta
		name="description"
		content="Un canvas collaboratif pour structurer objectifs, préconditions et actions."
	/>
</svelte:head>

<main
	class="flex h-screen min-h-[36rem] flex-col overflow-hidden bg-[var(--ui-bg)] text-[var(--ui-text)]"
>
	<header
		class="z-20 flex h-14 shrink-0 items-center justify-between border-b border-[var(--ui-border)] bg-[var(--ui-surface)] px-4"
	>
		<div class="flex min-w-0 items-center gap-4">
			<a
				class="flex items-center gap-2 rounded-md font-semibold tracking-tight focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--ui-accent)]"
				href={resolve('/')}
				aria-label="Accueil Sequit"
			>
				<span
					class="grid size-7 place-items-center rounded-lg bg-[var(--ui-text)] text-sm font-bold text-[var(--ui-surface)]"
					>S</span
				>
				<span>Sequit</span>
			</a>
			<div class="h-5 w-px bg-[var(--ui-border)]"></div>
			<DocumentMenu
				{title}
				onopen={() => {
					opening = true;
				}}
				onexport={exportAction}
			/>
		</div>
	</header>

	{#key generation}
		<CanvasWorkspace
			{source}
			onopened={(document: OpenedDocument | undefined) => {
				opened = document;
			}}
		/>
	{/key}
	{#if opening}<OpenDocumentDialog
			onopen={openSource}
			onclose={() => {
				opening = false;
			}}
		/>{/if}
</main>
