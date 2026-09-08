<script lang="ts">
	import type { CanvasModel } from '../web/ui/canvas/canvas-model';
	import WorkshopViewportStart from './WorkshopViewportStart.svelte';
	let initialCanvas = $state<CanvasModel>();
	let initialViewport = $state<HTMLDivElement>();
	function oncanvas(value: CanvasModel, element: HTMLDivElement) {
		initialCanvas = value;
		initialViewport = element;
	}
	import { onMount } from 'svelte';

	import type { LogicDocument } from '$lib/core/document/logic-document';
	import {
		CollaborationStatus,
		createCollaborativeDocumentSession,
		ProposalDecisionKind,
	} from '$lib/infrastructure/collaboration/collaborative-document-session';
	import { createWebSocketCollaborationTransport } from '$lib/infrastructure/collaboration/websocket-collaboration-transport';
	import { parseSequitToml } from '$lib/infrastructure/toml/parse-sequit-toml';

	import {
		type DocumentCommandOutcome,
		DocumentCommandOutcomeKind,
	} from '../../lib/infrastructure/document/document-command-contracts';
	import CanvasViewportControls from '../web/ui/components/canvas/CanvasViewportControls.svelte';
	import LogicCanvas from '../web/ui/components/canvas/LogicCanvas.svelte';
	import { CanvasSession } from '../web/ui/session/canvas-session.svelte';
	import PanelEditor from './PanelEditor.svelte';
	import { WorkshopCollaboration } from './runtime/workshop-collaboration';
	import { projectWorkshop } from './runtime/workshop-projection';
	import { WorkshopTransport } from './runtime/workshop-transport';
	let {
		source,
		room,
		name,
		peer,
		presentation,
		onpresence,
	}: {
		source: string;
		room: string;
		name: string;
		peer: string;
		presentation: string;
		onpresence: (value: string) => void;
	} = $props();
	let model = $state<LogicDocument>();
	let gateway: WorkshopCollaboration | undefined;
	let initialized = $state(false);
	let transport: WorkshopTransport | undefined;
	let status = $state(CollaborationStatus.Connecting);
	let paused = $state(false);
	let activity = $state<string[]>([]);
	const session = new CanvasSession({ replaceNodeMarkdown: save });
	session.zoom = 0.6;
	let projection = $derived.by(() => {
		if (model) return projectWorkshop(model, [], 1);
		return undefined;
	});
	function record(value: string) {
		activity = [value, ...activity].slice(0, 8);
	}
	function save(id: string, markdown: string): Promise<DocumentCommandOutcome> {
		if (!gateway)
			return Promise.resolve({
				kind: DocumentCommandOutcomeKind.Failed,
				error: new Error('Session indisponible'),
			});
		return gateway.replaceNodeMarkdown(id, markdown);
	}
	onMount(() => {
		const parsed = parseSequitToml(source);
		if (!parsed.ok) return;
		transport = new WorkshopTransport(() =>
			createWebSocketCollaborationTransport(room, window.location.origin),
		);
		const client = createCollaborativeDocumentSession({ ...parsed.value, id: room }, transport);
		model = client.read();
		const current = client;
		const commands = new WorkshopCollaboration(current, transport);
		gateway = commands;
		status = commands.status();
		const statuses = commands.subscribeToStatus((value) => {
			status = value;
			initialized = commands.canPause();
		});
		const stop = current.subscribe((value) => {
			model = value;
			status = current.connectionStatus();
			record('Document actualisé.');
		});
		const decisions = current.subscribeToDecisions((decision) => {
			if (decision.type === ProposalDecisionKind.Accepted) {
				record(`Version ${decision.commit} validée.`);
			} else {
				record('Modification refusée. Brouillon conservé.');
			}
		});
		return () => {
			statuses();
			stop();
			decisions();
			commands.destroy();
		};
	});
	$effect(() => {
		onpresence([...session.selection.values()].map((ref) => ref.id).join(', '));
	});
</script>

<section class="participant" aria-label={`Session ${name}`}>
	<header>
		<strong>{name}</strong><span role="status" class:ready={status === CollaborationStatus.Ready}
			>{#if paused}Hors ligne · reprise en attente{:else if status === CollaborationStatus.Ready}Connecté{:else if status === CollaborationStatus.Disconnected}Déconnecté{:else}Connexion…{/if}</span
		><button
			type="button"
			disabled={!initialized}
			onclick={() => {
				if (paused) {
					transport?.resume();
					paused = false;
				} else {
					transport?.pause();
					paused = true;
				}
			}}
		>
			{#if paused}Reconnecter{:else}Mettre hors ligne{/if}</button
		>
	</header>
	<div class="participant-canvas">
		{#if projection}<LogicCanvas {oncanvas} document={projection} {session}
				>{#snippet editor(editing, viewport)}<PanelEditor
						{editing}
						{viewport}
						{session}
					/>{/snippet}</LogicCanvas
			><WorkshopViewportStart
				canvas={initialCanvas}
				viewport={initialViewport}
			/><CanvasViewportControls {session} />{/if}
		{#if peer}<span class="presence">L’autre session : {peer}</span>{/if}
	</div>
	{#if presentation === 'activity'}<ol aria-label={`Activité ${name}`}>
			{#each activity as entry, i (i)}<li>{entry}</li>{/each}
		</ol>{/if}
</section>

<style>
	.participant {
		display: flex;
		flex-direction: column;
		min-width: 0;
		min-height: 0;
		border: 1px solid #dedad3;
		border-radius: 10px;
		overflow: hidden;
		background: white;
	}
	.participant header {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
		padding: 12px;
		font-size: 11px;
		border-bottom: 1px solid #dedad3;
	}
	.participant strong {
		font-size: 14px;
	}
	.participant header span {
		color: #9a6325;
		flex: 1;
	}
	.participant header span.ready {
		color: #16866c;
	}
	.participant button {
		padding: 5px 8px;
		border: 1px solid #d6d3d1;
		border-radius: 6px;
	}
	.participant-canvas {
		position: relative;
		flex: 1;
		min-height: 360px;
	}
	.presence {
		position: absolute;
		top: 10px;
		left: 10px;
		z-index: 20;
		background: #eae8ff;
		color: #50478f;
		padding: 5px 9px;
		border-radius: 6px;
		font-size: 10px;
		pointer-events: none;
	}
	.participant ol {
		height: 90px;
		overflow: auto;
		padding: 10px 16px;
		font-size: 11px;
		color: #78716c;
		list-style: none;
	}
</style>
