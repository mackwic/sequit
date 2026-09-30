<script lang="ts">
	import { onMount, untrack } from 'svelte';

	import { resolve } from '$app/paths';

	import { serializeSequitToml } from '../../../../lib/infrastructure/toml/serialize-sequit-toml';
	import type { OpenDocumentResult } from '../../projection/open-document';
	import { documentFilename } from '../document/document-filename';
	import { downloadText } from '../document/download-text';
	import {
		type RecentDocument,
		type RecentDocuments,
		RecentDocumentsStore,
	} from '../document/recent-documents';
	import CanvasWorkspace from './canvas/CanvasWorkspace.svelte';
	import DocumentMenu from './document/DocumentMenu.svelte';
	import OpenDocumentDialog from './document/OpenDocumentDialog.svelte';
	import RecentDocumentsDialog from './document/RecentDocumentsDialog.svelte';

	type OpenedDocument = Extract<OpenDocumentResult, { ok: true }>['value'];
	const UNTITLED = 'Sans titre';
	const SAVE_DELAY_MS = 400;
	let { source: initialSource }: { source: string } = $props();
	let source = $state(untrack(() => initialSource));
	let opened = $state<OpenedDocument>();
	let title = $state(UNTITLED);
	let dialog = $state<'open' | 'recent'>();
	// Each successful open is a new document, even when the bytes match the previous source.
	let generation = $state(0);
	let recent = $state<RecentDocuments>({ currentId: undefined, documents: [] });
	// False once this browser's storage refused a write: the document then only survives by export.
	let retained = $state(true);
	let store: RecentDocumentsStore | undefined;
	// Changes since the last successful persist or export.
	let unsaved = false;
	let pendingSave: ReturnType<typeof setTimeout> | undefined;
	// A document chosen by the user enters the recent list as soon as it opens.
	let rememberOnOpen = false;
	let exportAction = $derived.by(() => {
		if (!opened) return undefined;
		return exportDocument;
	});
	// The open dialog only promises retention when the current document is actually stored.
	let currentRetained = $derived.by(() => {
		const current = opened;
		if (!retained || !current) return false;
		const id = current.read().id;
		return recent.documents.some((document) => document.id === id);
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
		return current.subscribe(() => {
			readTitle();
			changed();
		});
	});

	onMount(() => {
		try {
			store = new RecentDocumentsStore(localStorage);
			recent = store.read();
		} catch {
			retained = false;
		}
		const current = recent.documents.find((document) => document.id === recent.currentId);
		if (current) openSource(current.source);
		const guard = (event: BeforeUnloadEvent): void => {
			persist();
			if (unsaved) event.preventDefault();
		};
		window.addEventListener('pagehide', persist);
		window.addEventListener('beforeunload', guard);
		return () => {
			window.removeEventListener('pagehide', persist);
			window.removeEventListener('beforeunload', guard);
			clearTimeout(pendingSave);
		};
	});

	function changed(): void {
		unsaved = true;
		clearTimeout(pendingSave);
		pendingSave = setTimeout(persist, SAVE_DELAY_MS);
	}

	function persist(): void {
		clearTimeout(pendingSave);
		pendingSave = undefined;
		const current = opened;
		if (!current || !store || !unsaved) return;
		const logic = current.read();
		try {
			recent = store.remember({
				id: logic.id,
				title: logic.title,
				source: serializeSequitToml(logic),
				updatedAt: Date.now(),
			});
			retained = true;
			unsaved = false;
		} catch {
			retained = false;
		}
	}

	function exportDocument(): void {
		const current = opened;
		if (!current) return;
		const logic = current.read();
		downloadText(serializeSequitToml(logic), documentFilename(logic.title, logic.id));
		persist();
		unsaved = false;
	}

	function openSource(next: string): void {
		persist();
		dialog = undefined;
		opened = undefined;
		unsaved = false;
		source = next;
		generation += 1;
	}

	function openChosen(next: string): void {
		rememberOnOpen = true;
		openSource(next);
	}

	// Called from the workspace's effect: reading page state here would make that effect re-run
	// (and destroy the document) whenever the page state changes.
	function workspaceOpened(document: OpenedDocument | undefined): void {
		untrack(() => {
			opened = document;
			if (!document || !rememberOnOpen) return;
			rememberOnOpen = false;
			unsaved = true;
			persist();
		});
	}

	function forget(id: string): void {
		if (!store) return;
		try {
			recent = store.forget(id);
			retained = true;
		} catch {
			retained = false;
		}
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
					dialog = 'open';
				}}
				onrecent={() => {
					dialog = 'recent';
				}}
				onexport={exportAction}
			/>
		</div>
	</header>

	{#key generation}
		<CanvasWorkspace {source} onopened={workspaceOpened} />
	{/key}
	{#if dialog === 'open'}
		<OpenDocumentDialog
			retained={currentRetained}
			onopen={openChosen}
			onclose={() => {
				dialog = undefined;
			}}
		/>
	{:else if dialog === 'recent'}
		<RecentDocumentsDialog
			documents={recent.documents}
			currentId={recent.currentId}
			{retained}
			onopen={(document: RecentDocument) => {
				openChosen(document.source);
			}}
			onforget={forget}
			onclose={() => {
				dialog = undefined;
			}}
		/>
	{/if}
</main>
