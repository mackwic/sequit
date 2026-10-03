<script lang="ts">
	import { onMount, untrack } from 'svelte';

	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';

	import type { LogicDocument } from '../../../../lib/core/document/logic-document';
	import { newRoomId } from '../../../../lib/infrastructure/collaboration/room-id';
	import {
		emptyDocument,
		UNTITLED_DOCUMENT_TITLE,
	} from '../../../../lib/infrastructure/document/document-creation';
	import { SharedElementKind } from '../../../../lib/infrastructure/document/shared-document-command';
	import { serializeSequitToml } from '../../../../lib/infrastructure/toml/serialize-sequit-toml';
	import {
		captureCollaborationStart,
		captureDocumentCreation,
		captureDocumentImport,
	} from '../../analytics/analytics';
	import { m } from '../../i18n/paraglide/messages';
	import type { OpenDocumentResult } from '../../projection/open-document';
	import { canvasStageElement } from '../canvas/canvas-image';
	import type { CanvasModel } from '../canvas/canvas-model';
	import { documentFileStem } from '../document/document-filename';
	import { readParticipantName, writeParticipantName } from '../document/participant-name';
	import {
		type RecentDocument,
		type RecentDocuments,
		RecentDocumentsStore,
	} from '../document/recent-documents';
	import { stashRoomSeed } from '../document/room-seed';
	import AppHeader from './AppHeader.svelte';
	import CanvasWorkspace from './canvas/CanvasWorkspace.svelte';
	import CollaborationDialog from './collaboration/CollaborationDialog.svelte';
	import DocumentMenu from './document/DocumentMenu.svelte';
	import ExportDocumentDialog from './document/ExportDocumentDialog.svelte';
	import ExportImageDialog from './document/ExportImageDialog.svelte';
	import NewDocumentDialog from './document/NewDocumentDialog.svelte';
	import OpenDocumentDialog from './document/OpenDocumentDialog.svelte';
	import RecentDocumentsDialog from './document/RecentDocumentsDialog.svelte';
	import Icon from './ui/Icon.svelte';

	type OpenedDocument = Extract<OpenDocumentResult, { ok: true }>['value'];
	const UNTITLED = UNTITLED_DOCUMENT_TITLE;
	const SAVE_DELAY_MS = 400;
	let { source: initialSource }: { source: string } = $props();
	let source = $state(untrack(() => initialSource));
	let main = $state<HTMLElement>();
	let opened = $state<OpenedDocument>();
	let title = $state(UNTITLED);
	let dialog = $state<'new' | 'open' | 'recent' | 'collaborate'>();
	let documentExport = $state<{ document: LogicDocument; canvas: CanvasModel | undefined }>();
	let renderedExport = $state<{ document: LogicDocument; canvas: CanvasModel }>();
	let imageExport = $state<{ stage: HTMLElement; stem: string }>();
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
		return openExport;
	});
	let exportImageAction = $derived.by(() => {
		if (!opened) return undefined;
		return exportImage;
	});
	let renameAction = $derived.by(() => {
		if (!opened) return undefined;
		return renameDocument;
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
		return current.subscribeToDocument(() => {
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
		const current =
			recent.documents.find((document) => document.id === recent.currentId) ?? recent.documents[0];
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

	function openExport(): void {
		const current = opened;
		if (!current) return;
		const logic = current.read();
		let canvas: CanvasModel | undefined;
		if (
			main &&
			canvasStageElement(main) &&
			renderedExport &&
			serializeSequitToml(renderedExport.document) === serializeSequitToml(logic)
		)
			canvas = renderedExport.canvas;
		documentExport = { document: logic, canvas };
	}

	function tomlDownloaded(): void {
		persist();
		unsaved = false;
	}

	function exportImage(): void {
		const current = opened;
		const stage = main && canvasStageElement(main);
		if (!current || !stage) return;
		const logic = current.read();
		imageExport = { stage, stem: documentFileStem(logic.title, logic.id) };
	}

	function renameDocument(next: string): void {
		const current = opened;
		if (!current) return;
		const target = { kind: SharedElementKind.Document, id: current.read().id } as const;
		current.session.updateText(target, 'title', next);
	}

	function openSource(next: string): void {
		persist();
		dialog = undefined;
		documentExport = undefined;
		renderedExport = undefined;
		opened = undefined;
		unsaved = false;
		source = next;
		generation += 1;
	}

	function openChosen(next: string): void {
		rememberOnOpen = true;
		openSource(next);
	}

	/** A blank document with the current natures; the current one follows the usual open path. */
	function createDocument(): void {
		const current = opened;
		if (!current) return;
		openChosen(
			serializeSequitToml(emptyDocument(current.read(), `document-${crypto.randomUUID()}`)),
		);
		captureDocumentCreation();
	}

	function importDocument(next: string): void {
		openChosen(next);
		captureDocumentImport();
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

	function startSession(name: string): void {
		const current = opened;
		if (!current) return;
		writeParticipantName(name);
		persist();
		// The room takes the document's identity: the server requires both names to match.
		const room = newRoomId();
		stashRoomSeed(room, serializeSequitToml({ ...current.read(), id: room }));
		dialog = undefined;
		captureCollaborationStart();
		void goto(resolve('/session/[room]', { room }));
	}
</script>

<svelte:head>
	<title>{m.document_page_title()}</title>
	<meta name="description" content={m.document_page_description()} />
</svelte:head>

<main
	class="flex h-dvh min-h-[36rem] flex-col overflow-hidden bg-[var(--ui-bg)] text-[var(--ui-text)] print:h-auto print:min-h-0 print:overflow-visible print:bg-transparent"
	bind:this={main}
>
	<AppHeader>
		<DocumentMenu
			{title}
			onrename={renameAction}
			onnew={() => {
				dialog = 'new';
			}}
			onopen={() => {
				dialog = 'open';
			}}
			onrecent={() => {
				dialog = 'recent';
			}}
			onexport={exportAction}
			onexportimage={exportImageAction}
		/>
		{#snippet actions()}
			<button
				class="ui-action"
				type="button"
				disabled={!opened}
				onclick={() => {
					dialog = 'collaborate';
				}}
			>
				<Icon name="phosphor:users" />
				<span class="max-sm:sr-only">{m.document_collaborate()}</span>
			</button>
		{/snippet}
	</AppHeader>

	{#key generation}
		<CanvasWorkspace
			{source}
			onopened={workspaceOpened}
			oncanvas={(canvas: CanvasModel) => {
				const current = opened;
				if (current) renderedExport = { document: current.read(), canvas };
			}}
			onexport={exportAction}
			onexportimage={exportImageAction}
		/>
	{/key}
	{#if dialog === 'new'}
		<NewDocumentDialog
			retained={currentRetained}
			oncreate={createDocument}
			onclose={() => {
				dialog = undefined;
			}}
		/>
	{:else if dialog === 'open'}
		<OpenDocumentDialog
			retained={currentRetained}
			onopen={importDocument}
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
	{:else if dialog === 'collaborate'}
		<CollaborationDialog
			name={readParticipantName()}
			onstart={startSession}
			onclose={() => {
				dialog = undefined;
			}}
		/>
	{/if}
	{#if documentExport}
		<ExportDocumentDialog
			document={documentExport.document}
			canvas={documentExport.canvas}
			onTomlDownloaded={tomlDownloaded}
			onclose={() => {
				documentExport = undefined;
			}}
		/>
	{/if}
	{#if imageExport}
		<ExportImageDialog
			stage={imageExport.stage}
			stem={imageExport.stem}
			onclose={() => {
				imageExport = undefined;
			}}
		/>
	{/if}
</main>
