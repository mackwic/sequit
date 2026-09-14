<script lang="ts">
	import { onMount, untrack } from 'svelte';

	import {
		defined,
		GroupState,
		type LogicDocument,
	} from '../../../../../lib/core/document/logic-document';
	import type { CollaborativeDocumentSession } from '../../../../../lib/infrastructure/collaboration/collaborative-document-session-types';
	import {
		SharedCommandKind as Op,
		type SharedDocumentCommand,
		SharedElementKind as Kind,
	} from '../../../../../lib/infrastructure/document/shared-document-command';
	import { createSharedCanvasProjection } from '../../../projection/open-document';
	import {
		deleteVisibleRelation,
		hiddenRelationFields,
	} from '../../../projection/visible-relation-commands';
	import { CanvasSession, type EditingCanvasActivity } from '../../session/canvas-session.svelte';
	import LogicCanvas from '../canvas/LogicCanvas.svelte';
	import { sharedSelection } from './canvas-awareness';
	import CanvasAwareness from './CanvasAwareness.svelte';
	import {
		CollaborationAwareness,
		setCollaborationAwareness,
	} from './collaboration-awareness.svelte';
	import SharedEditDialog from './SharedEditDialog.svelte';
	import SharedElementCard from './SharedElementCard.svelte';
	import SharedNodeFields from './SharedNodeFields.svelte';
	import SharedPropertyFields from './SharedPropertyFields.svelte';
	import SharedStructureControls from './SharedStructureControls.svelte';
	import SharedTextField from './SharedTextField.svelte';
	let {
		client,
		model,
		name,
		connected,
	}: {
		client: CollaborativeDocumentSession;
		model: LogicDocument;
		name: string;
		connected: boolean;
	} = $props();
	const canvas = new CanvasSession();
	const presence = new CollaborationAwareness(untrack(() => client));
	setCollaborationAwareness(presence);
	onMount(() => () => {
		presence.destroy();
	});
	let error = $state('');
	const projection = untrack(() => createSharedCanvasProjection(model));
	let visible = $state.raw(projection.visible);
	$effect(() => {
		try {
			projection.update(model);
			visible = projection.visible;
			error = projection.warning ?? '';
		} catch (failure) {
			error = `Ce repli ne peut pas être affiché. Dépliez le groupe. ${String(failure)}`;
		}
	});
	function dispatch(command: SharedDocumentCommand): void {
		dispatchMany([command]);
	}
	function dispatchMany(commands: readonly SharedDocumentCommand[]): void {
		try {
			client.dispatch(commands);
			error = '';
		} catch (failure) {
			if (failure instanceof Error) error = failure.message;
		}
	}
	$effect(() => {
		client.setPresence({
			name,
			color: `hsl(${client.document.clientID % 360} 65% 42%)`,
			selected: sharedSelection(canvas.selection.values()),
		});
	});
</script>

<div class="workspace">
	<div class="canvas">
		<LogicCanvas document={projection} session={canvas}>
			{#snippet awareness(model, viewport)}<CanvasAwareness canvas={model} {viewport} />{/snippet}
			{#snippet editor(editing: EditingCanvasActivity)}
				{@const node = visible.document.nodes.find((item) => item.id === editing.nodeId)}
				{#if node}<SharedEditDialog
						label={`Boîte ${editing.nodeId}`}
						onclose={() => canvas.cancel()}
					>
						<SharedNodeFields
							{node}
							{client}
							{connected}
							{dispatch}
							label={`Texte de ${editing.nodeId}`}
						/>
					</SharedEditDialog>{/if}
			{/snippet}
		</LogicCanvas>
	</div>
	<aside aria-label="Document partagé">
		<SharedElementCard label="Titre du document">
			<SharedTextField
				{client}
				target={{ kind: Kind.Document, id: model.id }}
				field="title"
				label="Titre du document"
			/>
		</SharedElementCard>
		<SharedStructureControls model={visible.document} {connected} {dispatch} />
		{#if error}<p role="alert">{error}</p>{/if}
		{#each visible.document.nodes as node (node.id)}
			<section aria-label={`Boîte ${node.id}`}>
				<SharedElementCard label={`Boîte ${node.id}`}>
					<SharedNodeFields {node} {client} {connected} {dispatch} label={`Contenu ${node.id}`} />
				</SharedElementCard>
			</section>
		{/each}
		{#each visible.document.groups as group (group.id)}
			<section aria-label={`Groupe ${group.id}`}>
				<SharedElementCard label={`Groupe ${group.id}`}>
					<SharedTextField
						{client}
						target={{ kind: Kind.Group, id: group.id }}
						field="label"
						label={`Libellé du groupe ${group.id}`}
					/>
					<SharedPropertyFields
						target={{ kind: Kind.Group, id: group.id }}
						properties={{ groupId: group.groupId }}
						{connected}
						{dispatch}
					/>
					<p>
						{model.nodes
							.filter((node) => node.groupId === group.id)
							.map((node) => node.id)
							.join(', ')}
					</p>
					<button
						type="button"
						disabled={!connected}
						onclick={() => {
							dispatch({
								op: Op.Update,
								target: { kind: Kind.Group, id: group.id },
								set: { state: GroupState.Closed },
								unset: [],
							});
						}}>Replier {group.id}</button
					>
					<button
						type="button"
						disabled={!connected}
						onclick={() => {
							dispatch({
								op: Op.Update,
								target: { kind: Kind.Group, id: group.id },
								set: { state: GroupState.Expanded },
								unset: [],
							});
						}}>Déplier {group.id}</button
					>
					<output aria-label={`État de ${group.id}`}>{group.state ?? GroupState.Expanded}</output>
					<button
						type="button"
						disabled={!connected}
						onclick={() => {
							dispatch({ op: Op.Ungroup, id: group.id });
						}}>Dissoudre {group.id}</button
					>
				</SharedElementCard>
			</section>
		{/each}
		{#each model.natures as nature (nature.id)}
			<section aria-label={`Nature ${nature.id}`}>
				<SharedElementCard label={`Nature ${nature.id}`}>
					<SharedTextField
						{client}
						target={{ kind: Kind.Nature, id: nature.id }}
						field="label"
						label={`Libellé de la nature ${nature.id}`}
					/>
					<SharedPropertyFields
						target={{ kind: Kind.Nature, id: nature.id }}
						properties={{ color: nature.color, icon: nature.icon }}
						{connected}
						{dispatch}
					/>
					<button
						type="button"
						disabled={!connected}
						onclick={() => {
							dispatch({ op: Op.Delete, target: { kind: Kind.Nature, id: nature.id } });
						}}>Supprimer la nature {nature.id}</button
					>
				</SharedElementCard>
			</section>
		{/each}
		{#each visible.document.junctions as junction (junction.id)}
			<section aria-label={`Jonction ${junction.id}`}>
				<SharedElementCard label={`Jonction ${junction.id}`}>
					<strong>{junction.id}</strong>
					<SharedPropertyFields
						target={{ kind: Kind.Junction, id: junction.id }}
						properties={{ operator: junction.operator, groupId: junction.groupId }}
						{connected}
						{dispatch}
					/>
					<button
						type="button"
						disabled={!connected}
						onclick={() => {
							dispatch({ op: Op.Delete, target: { kind: Kind.Junction, id: junction.id } });
						}}>Supprimer la jonction {junction.id}</button
					>
				</SharedElementCard>
			</section>
		{/each}
		<ul aria-label="Relations">
			{#each visible.document.relations as relation (relation.id)}
				{@const provenance = defined(visible.relations.get(relation.id))}
				<li>
					{relation.from} → {relation.to}
					<SharedElementCard label={`Relation ${relation.id}`}
						><SharedPropertyFields
							target={{ kind: Kind.Relation, id: relation.id }}
							properties={{ from: relation.from, to: relation.to }}
							disabledFields={hiddenRelationFields(provenance)}
							{connected}
							{dispatch}
						/><button
							type="button"
							disabled={!connected}
							onclick={() => {
								dispatchMany(deleteVisibleRelation(provenance));
							}}>Supprimer la relation {relation.id}</button
						>
					</SharedElementCard>
				</li>{/each}
		</ul>
	</aside>
</div>

<style>
	.workspace {
		display: grid;
		grid-template-columns: minmax(240px, 1fr) 330px;
		flex: 1;
		min-height: 0;
	}
	.canvas {
		position: relative;
		min-height: 450px;
	}
	aside {
		overflow: auto;
		padding: 14px;
		border-left: 1px solid #ddd8d0;
	}
	section {
		margin-top: 16px;
		display: grid;
		gap: 6px;
	}
	button {
		border: 1px solid #d6d3d1;
		border-radius: 4px;
		padding: 4px 6px;
	}
	button {
		cursor: pointer;
	}
	button:disabled {
		opacity: 0.5;
	}
	@media (max-width: 640px) {
		.workspace {
			grid-template-columns: minmax(0, 1fr);
			grid-template-rows: minmax(320px, 60vh) minmax(0, 1fr);
		}
		.canvas {
			min-height: 0;
		}
		aside {
			border-left: 0;
			border-top: 1px solid #ddd8d0;
		}
	}
</style>
