<script lang="ts">
	import { onMount } from 'svelte';

	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';

	import { defaultNatures } from '../../../../lib/core/document/default-natures';
	import {
		LayoutBias,
		LayoutDirection,
		type LogicDocument,
		PERSISTENCE_FORMAT,
	} from '../../../../lib/core/document/logic-document';
	import { CollaborationStatus } from '../../../../lib/infrastructure/collaboration/collaborative-document-session';
	import { createWebSocketCollaborationTransport } from '../../../../lib/infrastructure/collaboration/websocket-collaboration-transport';
	import { parseSequitToml } from '../../../../lib/infrastructure/toml/parse-sequit-toml';
	import { serializeSequitToml } from '../../../../lib/infrastructure/toml/serialize-sequit-toml';
	import { consumeCollaborationError } from '../../document/collaboration-rejection';
	import { documentFilename } from '../document/document-filename';
	import { downloadText } from '../document/download-text';
	import { readParticipantName, writeParticipantName } from '../document/participant-name';
	import { RecentDocumentsStore } from '../document/recent-documents';
	import { takeRoomSeed } from '../document/room-seed';
	import AppHeader from './AppHeader.svelte';
	import CollaborationDialog from './collaboration/CollaborationDialog.svelte';
	import CollaborativeWorkspace from './collaboration/CollaborativeWorkspace.svelte';
	import { LiveSession } from './collaboration/live-session.svelte';
	import ParticipantAvatars from './collaboration/ParticipantAvatars.svelte';
	import ShareDialog from './collaboration/ShareDialog.svelte';
	import DocumentMenu from './document/DocumentMenu.svelte';
	import Icon from './ui/Icon.svelte';

	const UNTITLED = 'Sans titre';
	let { room }: { room: string } = $props();
	let name = $state('');
	let session = $state<LiveSession>();
	let dialog = $state<'name' | 'share'>();
	let toast = $state<string>();
	let link = $state('');
	let path = $derived(resolve('/session/[room]', { room }));
	let title = $derived.by(() => {
		const current = session?.model?.title ?? '';
		if (current === '') return UNTITLED;
		return current;
	});
	let statusLabel = $derived.by(() => {
		if (session?.status === CollaborationStatus.Ready) return 'Connecté';
		if (session?.status === CollaborationStatus.Disconnected) return 'Hors ligne';
		if (session?.status === CollaborationStatus.Synchronizing) return 'Synchronisation…';
		return 'Connexion…';
	});
	let exportAction = $derived.by(() => {
		if (!session?.model) return undefined;
		return exportDocument;
	});

	onMount(() => {
		toast = consumeCollaborationError();
		link = `${window.location.origin}${path}`;
		name = readParticipantName();
		if (name === '') dialog = 'name';
		else connect();
		return () => {
			session?.destroy();
		};
	});

	$effect(() => {
		const conflict = session?.conflict;
		if (conflict === undefined) return;
		toast = conflict;
	});

	/**
	 * A joiner proposes nothing: the server keeps the room's state and ignores this document. A
	 * room opened without a seed starts from it, so it carries the default natures.
	 */
	function emptyDocument(): LogicDocument {
		return {
			persistenceFormat: PERSISTENCE_FORMAT,
			id: room,
			title: UNTITLED,
			layout: { direction: LayoutDirection.TopToBottom, bias: LayoutBias.Top },
			natures: defaultNatures(),
			groups: [],
			nodes: [],
			junctions: [],
			relations: [],
		};
	}

	function initialDocument(): LogicDocument {
		const seed = takeRoomSeed(room);
		if (seed === undefined) return emptyDocument();
		const parsed = parseSequitToml(seed);
		if (!parsed.ok) return emptyDocument();
		return { ...parsed.value, id: room };
	}

	function connect(): void {
		session = new LiveSession(
			initialDocument(),
			createWebSocketCollaborationTransport(room, window.location.origin),
		);
	}

	function join(chosen: string): void {
		name = chosen;
		writeParticipantName(chosen);
		dialog = undefined;
		connect();
	}

	function rename(next: string): void {
		name = next;
		writeParticipantName(next);
	}

	function exportDocument(): void {
		const model = session?.model;
		if (!model) return;
		downloadText(serializeSequitToml(model), documentFilename(model.title, model.id));
	}

	/** Leaving keeps a local copy: the room lives on for the others. */
	function leave(): void {
		const model = session?.model;
		if (model) {
			try {
				new RecentDocumentsStore(localStorage).remember({
					id: model.id,
					title: model.title,
					source: serializeSequitToml(model),
					updatedAt: Date.now(),
				});
			} catch {
				// Storage refused: the participant leaves without a copy, as announced in the dialog.
			}
		}
		dialog = undefined;
		void goto(resolve('/'));
	}
</script>

<svelte:head>
	<title>{title} — Session Sequit</title>
</svelte:head>

<main
	class="flex h-screen min-h-[36rem] flex-col overflow-hidden bg-[var(--ui-bg)] text-[var(--ui-text)]"
>
	<AppHeader>
		<DocumentMenu {title} onexport={exportAction} />
		{#snippet actions()}
			<p class="status m-0 flex items-center gap-2 text-xs text-[var(--ui-muted)]" role="status">
				<span
					class="dot"
					class:ready={session?.status === CollaborationStatus.Ready}
					class:offline={session?.status === CollaborationStatus.Disconnected}
					aria-hidden="true"
				></span>
				{statusLabel}
			</p>
			{#if session}<ParticipantAvatars
					participants={session.participants}
					selfId={session.client.document.clientID}
					following={session.awareness.following}
					onfollow={(clientId: number) => {
						session?.awareness.follow(clientId);
					}}
				/>{/if}
			<button
				class="ui-action primary"
				type="button"
				onclick={() => {
					dialog = 'share';
				}}
			>
				<Icon name="phosphor:share-network" /> Partager
			</button>
		{/snippet}
	</AppHeader>

	{#if toast}
		<div class="ui-notice error m-3 mb-0" role="status" aria-live="polite" aria-atomic="true">
			<Icon name="phosphor:warning-circle" />
			<p class="m-0 flex-1">{toast}</p>
			<button
				class="ui-action quiet"
				type="button"
				aria-label="Fermer la notification"
				onclick={() => {
					toast = undefined;
				}}><Icon name="phosphor:x" /></button
			>
		</div>
	{/if}

	{#if session}
		{#key session.replica}
			{#if session.model && session.initialized}
				<CollaborativeWorkspace
					client={session.client}
					model={session.model}
					awareness={session.awareness}
					{name}
					connected={session.connected}
					textEditable={session.textEditable}
					panel={false}
				/>
			{:else}
				<p class="m-8 text-sm text-[var(--ui-muted)]">{statusLabel}</p>
			{/if}
		{/key}
	{/if}

	{#if dialog === 'name'}
		<CollaborationDialog
			{name}
			joining
			onstart={join}
			onclose={() => {
				void goto(resolve('/'));
			}}
		/>
	{:else if dialog === 'share'}
		<ShareDialog
			{link}
			{name}
			onrename={rename}
			onleave={leave}
			onclose={() => {
				dialog = undefined;
			}}
		/>
	{/if}
</main>

<style>
	.dot {
		width: 8px;
		height: 8px;
		border-radius: 999px;
		background: var(--ui-warning);
	}
	.dot.ready {
		background: var(--ui-success);
	}
	.dot.offline {
		background: var(--ui-danger);
	}
</style>
