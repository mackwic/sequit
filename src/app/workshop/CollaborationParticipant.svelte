<script lang="ts">
	import { onMount } from 'svelte';

	import { CollaborationStatus } from '../../lib/infrastructure/collaboration/collaborative-document-session';
	import { createWebSocketCollaborationTransport } from '../../lib/infrastructure/collaboration/websocket-collaboration-transport';
	import { parseSequitToml } from '../../lib/infrastructure/toml/parse-sequit-toml';
	import { consumeCollaborationError } from '../web/document/collaboration-rejection';
	import CollaborativeWorkspace from '../web/ui/components/collaboration/CollaborativeWorkspace.svelte';
	import { LiveSession } from '../web/ui/components/collaboration/live-session.svelte';
	import { WorkshopTransport } from './runtime/workshop-transport';
	let { source, room, name }: { source: string; room: string; name: string } = $props();
	let session = $state<LiveSession>();
	let transport: WorkshopTransport | undefined;
	let paused = $state(false);
	let toast = $state<string>();
	onMount(() => {
		toast = consumeCollaborationError();
		const parsed = parseSequitToml(source);
		if (!parsed.ok) return;
		const socket = new WorkshopTransport(() =>
			createWebSocketCollaborationTransport(room, window.location.origin),
		);
		transport = socket;
		const current = new LiveSession({ ...parsed.value, id: room }, socket);
		session = current;
		return () => {
			current.destroy();
		};
	});
	$effect(() => {
		const conflict = session?.conflict;
		if (conflict === undefined) return;
		toast = conflict;
	});
</script>

<section class="participant" aria-label={`Session ${name}`}>
	<header>
		<strong>{name}</strong>
		<span role="status" aria-label="Connexion"
			>{#if session?.status === CollaborationStatus.Ready}Connecté{:else if session?.status === CollaborationStatus.Disconnected}Hors
				ligne{:else if session?.status === CollaborationStatus.Synchronizing}Synchronisation…{:else}Connexion…{/if}</span
		>
		<button
			type="button"
			disabled={session?.initialized !== true}
			onclick={() => {
				if (paused) transport?.resume();
				else transport?.pause();
				paused = !paused;
			}}
			>{#if paused}Reconnecter{:else}Mettre hors ligne{/if}</button
		>
		<span aria-label="Participants"
			>{(session?.participants ?? [])
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
	{#if session}
		{#key session.replica}
			{#if session.model && session.initialized}
				<CollaborativeWorkspace
					client={session.client}
					model={session.model}
					{name}
					connected={session.connected}
					textEditable={session.textEditable}
					awareness={session.awareness}
				/>
			{/if}
		{/key}
	{/if}
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
