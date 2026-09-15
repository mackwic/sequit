<script lang="ts">
	import { onMount, untrack } from 'svelte';

	import {
		defined,
		EndpointKind,
		GroupState,
		type LogicDocument,
	} from '../../../../../lib/core/document/logic-document';
	import { projectDeletion } from '../../../../../lib/core/document/topology-deletions';
	import { projectRelationAddition } from '../../../../../lib/core/document/topology-edits';
	import { fractionalOrderKeySpace } from '../../../../../lib/core/ordering/order-key-space';
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
	import { EntityKind } from '../../canvas/canvas-entity';
	import {
		planRelativeNodeCreation,
		type RelativeNodePosition,
	} from '../../canvas/relative-node-creation';
	import { CanvasSession, type EditingCanvasActivity } from '../../session/canvas-session.svelte';
	import CanvasGestures from '../canvas/CanvasGestures.svelte';
	import LogicCanvas from '../canvas/LogicCanvas.svelte';
	import { sharedSelection } from './canvas-awareness';
	import CanvasAwareness from './CanvasAwareness.svelte';
	import {
		CollaborationAwareness,
		setCollaborationAwareness,
	} from './collaboration-awareness.svelte';
	import CreateNodeDialog from './CreateNodeDialog.svelte';
	import SharedEditDialog from './SharedEditDialog.svelte';
	import SharedElementCard from './SharedElementCard.svelte';
	import SharedGroupFields from './SharedGroupFields.svelte';
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
	let creating = $state(false);
	let editingGroupId = $state<string>();
	let editingGroup = $derived(model.groups.find(({ id }) => id === editingGroupId));
	let creationGroupId = $state<string>();
	let lastNatureId = $state<string>();
	function creationParent(): { groupId?: string } {
		if (creationGroupId === undefined) return {};
		return { groupId: creationGroupId };
	}
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
	function dispatchMany(commands: readonly SharedDocumentCommand[]): boolean {
		try {
			client.dispatch(commands);
			error = '';
			return true;
		} catch (failure) {
			if (failure instanceof Error) error = failure.message;
			return false;
		}
	}
	function connect(from: string, to: string) {
		if (!connected) return;
		const relation = { id: crypto.randomUUID(), from, to };
		const candidate = projectRelationAddition(model, relation, fractionalOrderKeySpace);
		if (!candidate.ok) {
			error = candidate.diagnostics.map(({ message }) => message).join('; ');
			return;
		}
		dispatch({
			op: Op.Create,
			target: { kind: Kind.Relation, id: relation.id },
			properties: { from, to },
		});
	}
	function deleteSelection() {
		if (!connected || canvas.editing) return;
		const selected = sharedSelection(canvas.selection.values());
		const relationIds = selected
			.filter(({ kind }) => kind === Kind.Relation)
			.flatMap(({ id }) => visible.relations.get(id)?.sourceRelationIds ?? []);
		if (
			dispatchDeletion(
				selected.filter(({ kind }) => kind !== Kind.Relation).map(({ id }) => id),
				relationIds,
			)
		)
			canvas.clearSelection();
	}
	function dispatchDeletion(
		endpointIds: readonly string[],
		relationIds: readonly string[],
	): boolean {
		const changes = projectDeletion(model, endpointIds, relationIds);
		const commands: SharedDocumentCommand[] = [];
		const relations = changes.relationRemovals ?? [];
		if (relations.length > 0) commands.push({ op: Op.DeleteRelations, ids: relations });
		for (const { endpointKind, endpointId } of changes.endpointRemovals ?? []) {
			if (endpointKind === EndpointKind.Group) commands.push({ op: Op.Ungroup, id: endpointId });
			else {
				let kind = Kind.Node;
				if (endpointKind === EndpointKind.Junction) kind = Kind.Junction;
				commands.push({ op: Op.Delete, target: { kind, id: endpointId } });
			}
		}
		return commands.length > 0 && dispatchMany(commands);
	}
	function createRelativeNode(position: RelativeNodePosition): void {
		const target = canvas.relativeNodeCreationTarget;
		if (!connected || target === undefined) return;
		const plan = planRelativeNodeCreation(model, target, position, {
			nodeId: crypto.randomUUID(),
			relationId: () => crypto.randomUUID(),
			lastNatureId,
		});
		if (plan === undefined) {
			error = 'Ajoutez d’abord une nature au document.';
			return;
		}
		const { id: nodeId, ...properties } = plan.node;
		const commands: SharedDocumentCommand[] = [
			{
				op: Op.Create,
				target: { kind: Kind.Node, id: nodeId },
				properties,
			},
			...plan.relations.map(({ id, from, to }) => ({
				op: Op.Create as const,
				target: { kind: Kind.Relation as const, id },
				properties: { from, to },
			})),
		];
		if (!dispatchMany(commands)) return;
		lastNatureId = plan.node.natureId;
		canvas.queueNodeMarkdownEdit(plan.node, () => {
			dispatchDeletion([plan.node.id], []);
		});
	}
	function groupSelection(): void {
		if (!connected) return;
		const members = [...canvas.selection.values()]
			.filter(({ kind }) => kind === EntityKind.Node)
			.map(({ id }) => id);
		if (members.length < 2 || members.length !== canvas.selectionCount) return;
		if (
			dispatchMany([
				{
					op: Op.Group,
					id: crypto.randomUUID(),
					label: 'Groupe',
					members,
				},
			])
		)
			canvas.clearSelection();
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
		<CanvasGestures
			session={canvas}
			enabled={connected && !creating && editingGroupId === undefined}
			oncreate={(groupId: string | undefined) => {
				creationGroupId = groupId;
				creating = true;
			}}
			onconnect={connect}
			ondelete={deleteSelection}
			oncreaterelative={createRelativeNode}
		>
			<LogicCanvas
				document={projection}
				session={canvas}
				onGroup={groupSelection}
				onGroupEdit={(groupId: string) => {
					editingGroupId = groupId;
				}}
			>
				{#snippet awareness(model, viewport)}<CanvasAwareness canvas={model} {viewport} />{/snippet}
				{#snippet editor(editing: EditingCanvasActivity)}
					{@const node = visible.document.nodes.find((item) => item.id === editing.nodeId)}
					{#if node}<SharedEditDialog
							label={`Boîte ${editing.nodeId}`}
							onclose={() => canvas.cancel(true)}
							oncancel={() => canvas.cancel()}
							oncommitclose={() => canvas.cancel(true)}
						>
							{#key editing.nodeId}
								<div class="editor-step">
									<SharedNodeFields
										{node}
										{client}
										{connected}
										{dispatch}
										label={`Texte de ${editing.nodeId}`}
										autofocusMarkdown
									/>
								</div>
							{/key}
						</SharedEditDialog>{/if}
				{/snippet}
			</LogicCanvas>
		</CanvasGestures>
		{#if editingGroup}<SharedEditDialog
				label={`Groupe ${editingGroup.label}`}
				description="Le titre et la couleur sont partagés en direct."
				onclose={() => {
					editingGroupId = undefined;
				}}
			>
				<SharedGroupFields group={editingGroup} {client} {connected} {dispatch} />
			</SharedEditDialog>{/if}
		{#if creating}<CreateNodeDialog
				natures={model.natures}
				{connected}
				onclose={() => {
					creating = false;
				}}
				oncreate={(natureId: string, markdown: string) => {
					lastNatureId = natureId;
					if (
						dispatchMany([
							{
								op: Op.Create,
								target: { kind: Kind.Node, id: crypto.randomUUID() },
								properties: { natureId, markdown, ...creationParent() },
							},
						])
					)
						creating = false;
				}}
			/>{/if}
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
						properties={{ color: group.color, groupId: group.groupId }}
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
	.editor-step {
		animation: editor-step-in 160ms cubic-bezier(0.22, 1, 0.36, 1);
	}
	@keyframes editor-step-in {
		from {
			opacity: 0;
			transform: translateX(10px);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.editor-step {
			animation: none;
		}
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
