<script lang="ts">
	import { GroupState, type LogicDocument } from '../../../../../lib/core/document/logic-document';
	import type { CollaborativeDocumentSession } from '../../../../../lib/infrastructure/collaboration/collaborative-document-session-types';
	import {
		SharedCommandKind as Op,
		type SharedDocumentCommand,
		SharedElementKind as Kind,
	} from '../../../../../lib/infrastructure/document/shared-document-command';
	import { createSharedCanvasProjection } from '../../../projection/open-document';
	import { CanvasSession, type EditingCanvasActivity } from '../../session/canvas-session.svelte';
	import LogicCanvas from '../canvas/LogicCanvas.svelte';
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
	let error = $state('');
	const projection = $derived.by(() => {
		try {
			return createSharedCanvasProjection(model);
		} catch {
			return undefined;
		}
	});
	function dispatch(command: SharedDocumentCommand): void {
		try {
			client.dispatch([command]);
			error = '';
		} catch (failure) {
			if (failure instanceof Error) error = failure.message;
		}
	}
	$effect(() => {
		client.setPresence({
			name,
			color: '#6f70e8',
			selected: [...canvas.selection.values()].map((item) => item.id),
		});
	});
</script>

<div class="workspace">
	<div class="canvas">
		{#if projection}<LogicCanvas document={projection} session={canvas}>
				{#snippet editor(editing: EditingCanvasActivity)}
					<div class="inline-editor">
						<SharedTextField
							{client}
							target={{ kind: Kind.Node, id: editing.nodeId }}
							field="markdown"
							label={`Texte de ${editing.nodeId}`}
						/>
						<button type="button" onclick={() => canvas.cancel()}>Fermer</button>
					</div>
				{/snippet}
			</LogicCanvas>{:else}<p role="alert">
				Ce repli ne peut pas être affiché. Dépliez le groupe.
			</p>{/if}
	</div>
	<aside aria-label="Document partagé">
		<SharedTextField
			{client}
			target={{ kind: Kind.Document, id: model.id }}
			field="title"
			label="Titre du document"
			rows={1}
		/>
		<SharedStructureControls {model} {connected} {dispatch} />
		{#if error}<p role="alert">{error}</p>{/if}
		{#each model.nodes as node (node.id)}
			<section aria-label={`Boîte ${node.id}`}>
				<header>
					<strong>{node.id}</strong><button
						type="button"
						disabled={!connected}
						onclick={() => {
							dispatch({ op: Op.Delete, target: { kind: Kind.Node, id: node.id } });
						}}>Supprimer {node.id}</button
					>
				</header>
				<SharedTextField
					{client}
					target={{ kind: Kind.Node, id: node.id }}
					field="markdown"
					label={`Contenu ${node.id}`}
				/>
				<SharedPropertyFields
					target={{ kind: Kind.Node, id: node.id }}
					properties={{
						natureId: node.natureId,
						groupId: node.groupId,
						color: node.color,
						icon: node.icon,
					}}
					{connected}
					{dispatch}
				/>
			</section>
		{/each}
		{#each model.groups as group (group.id)}
			<section aria-label={`Groupe ${group.id}`}>
				<SharedTextField
					{client}
					target={{ kind: Kind.Group, id: group.id }}
					field="label"
					label={`Libellé du groupe ${group.id}`}
					rows={1}
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
			</section>
		{/each}
		{#each model.natures as nature (nature.id)}
			<section aria-label={`Nature ${nature.id}`}>
				<SharedTextField
					{client}
					target={{ kind: Kind.Nature, id: nature.id }}
					field="label"
					label={`Libellé de la nature ${nature.id}`}
					rows={1}
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
			</section>
		{/each}
		{#each model.junctions as junction (junction.id)}
			<section aria-label={`Jonction ${junction.id}`}>
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
			</section>
		{/each}
		<ul aria-label="Relations">
			{#each model.relations as relation (relation.id)}<li>
					{relation.from} → {relation.to}<SharedPropertyFields
						target={{ kind: Kind.Relation, id: relation.id }}
						properties={{ from: relation.from, to: relation.to }}
						{connected}
						{dispatch}
					/><button
						type="button"
						disabled={!connected}
						onclick={() => {
							dispatch({ op: Op.Delete, target: { kind: Kind.Relation, id: relation.id } });
						}}>Supprimer la relation {relation.id}</button
					>
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
	header {
		display: flex;
		justify-content: space-between;
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
	.inline-editor {
		pointer-events: auto;
		position: absolute;
		top: 15px;
		right: 15px;
		width: min(300px, calc(100% - 30px));
		padding: 12px;
		background: white;
		border: 1px solid #ddd8d0;
		z-index: 30;
	}
</style>
