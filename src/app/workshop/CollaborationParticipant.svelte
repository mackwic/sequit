<script lang="ts">
	import { onMount } from 'svelte';

	import type { Pathname } from '$app/types';

	import type { LogicDocument } from '../../lib/core/document/logic-document';
	import {
		CollaborationStatus,
		type CollaborativeDocumentSession,
		createCollaborativeDocumentSession,
	} from '../../lib/infrastructure/collaboration/collaborative-document-session';
	import type { ParticipantPresence } from '../../lib/infrastructure/collaboration/session-wire';
	import { createWebSocketCollaborationTransport } from '../../lib/infrastructure/collaboration/websocket-collaboration-transport';
	import { parseSequitToml } from '../../lib/infrastructure/toml/parse-sequit-toml';
	import {
		consumeCollaborationError,
		refreshRejectedSession,
	} from '../web/document/collaboration-rejection';
	import CollaborativeWorkspace from '../web/ui/components/collaboration/CollaborativeWorkspace.svelte';
	import { WorkshopTransport } from './runtime/workshop-transport';
	let {
		source,
		room,
		name,
		path = '/atelier/collaboration',
		offlineTextEditing = false,
	}: {
		source: string;
		room: string;
		name: string;
		path?: Pathname;
		offlineTextEditing?: boolean;
	} = $props();
	let model = $state.raw<LogicDocument>();
	let client = $state<CollaborativeDocumentSession>();
	let participants = $state<readonly ParticipantPresence[]>([]);
	let transport: WorkshopTransport | undefined;
	let status = $state(CollaborationStatus.Connecting);
	let initialized = $state(false);
	let replica = $state(0);
	let paused = $state(false);
	let toast = $state<string>();
	onMount(() => {
		toast = consumeCollaborationError(path);
		const parsed = parseSequitToml(source);
		if (!parsed.ok) return;
		const socket = new WorkshopTransport(() =>
			createWebSocketCollaborationTransport(room, window.location.origin),
		);
		transport = socket;
		const current = createCollaborativeDocumentSession({ ...parsed.value, id: room }, socket, {
			offlineTextEditing,
		});
		client = current;
		const updateStatus = (): void => {
			if (replica !== current.replica()) {
				replica = current.replica();
				model = undefined;
				initialized = false;
			}
			status = current.connectionStatus();
			if (status === CollaborationStatus.Ready) {
				model ??= current.read();
				initialized = true;
			}
		};
		const cleanup = [
			current.subscribe((value) => {
				model = value;
			}),
			current.subscribeToRejection(refreshRejectedSession),
			current.subscribeToConflict((message) => {
				toast = message;
				updateStatus();
			}),
			current.subscribeToSourceState(updateStatus),
			current.subscribeToPresence((value) => {
				participants = value;
			}),
			socket.subscribeToFrames(updateStatus),
			socket.subscribeToStatus(updateStatus),
		];
		return () => {
			for (const stop of cleanup) stop();
			current.destroy();
		};
	});
</script>

<section class="participant" aria-label={`Session ${name}`}>
	<header>
		<strong>{name}</strong>
		<span role="status" aria-label="Connexion"
			>{#if status === CollaborationStatus.Ready}Connecté{:else if status === CollaborationStatus.Disconnected}Hors
				ligne{:else if status === CollaborationStatus.Synchronizing}Synchronisation…{:else}Connexion…{/if}</span
		>
		<button
			type="button"
			disabled={!initialized}
			onclick={() => {
				if (paused) transport?.resume();
				else transport?.pause();
				paused = !paused;
			}}
			>{#if paused}Reconnecter{:else}Mettre hors ligne{/if}</button
		>
		<span aria-label="Participants"
			>{participants
				.map((person) => `${person.name} ${person.selected.map((item) => item.id).join(', ')}`)
				.join(' · ')}</span
		>
	</header>
	{#if toast}<div class="toast" role="status" aria-live="polite" aria-atomic="true">
			{toast}<button
				type="button"
				aria-label="Fermer la notification"
				onclick={() => {
					toast = undefined;
				}}>×</button
			>
		</div>{/if}
	{#key replica}
		{#if client && model && initialized}
			<CollaborativeWorkspace
				{client}
				{model}
				{name}
				connected={status === CollaborationStatus.Ready}
				offlineTextEditing={offlineTextEditing &&
					paused &&
					status === CollaborationStatus.Disconnected}
			/>
		{/if}
	{/key}
</section>

<style>
	.participant {
		display: flex;
		flex-direction: column;
		min-height: 600px;
		height: 100%;
		border: 1px solid #dedad3;
		border-radius: 10px;
		background: white;
		overflow: hidden;
	}
	header {
		display: flex;
		flex-wrap: wrap;
		gap: 14px;
		align-items: center;
		padding: 12px;
		border-bottom: 1px solid #dedad3;
		font-size: 12px;
	}
	button {
		padding: 5px 8px;
		border: 1px solid #d6d3d1;
		border-radius: 6px;
	}
	.toast {
		max-width: 450px;
		margin: 8px 12px 0;
		padding: 8px 12px;
		border-radius: 6px;
		background: #fff0ec;
		color: #8f2416;
		box-shadow: 0 4px 24px #0002;
	}
</style>
