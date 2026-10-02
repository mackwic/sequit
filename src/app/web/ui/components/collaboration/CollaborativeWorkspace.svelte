<script lang="ts">
	import { onMount, untrack } from 'svelte';

	import {
		defined,
		GroupState,
		type JunctionOperator,
		JunctionOperator as Operator,
		type LayoutConfiguration,
		type LogicDocument,
	} from '../../../../../lib/core/document/logic-document';
	import { projectRelationAddition } from '../../../../../lib/core/document/topology-edits';
	import { fractionalOrderKeySpace } from '../../../../../lib/core/ordering/order-key-space';
	import {
		type CollaborativeDocumentSession,
		SourceDocumentStateKind,
	} from '../../../../../lib/infrastructure/collaboration/collaborative-document-session-types';
	import {
		type DocumentCommandOutcome,
		DocumentCommandOutcomeKind,
	} from '../../../../../lib/infrastructure/document/document-command-contracts';
	import {
		natureCreation,
		natureDeletion,
		type NatureEditing,
		natureEditing,
		NatureEditingMode,
		type NatureFields,
		natureStyleUpdate,
		natureUsage,
		newNatureEditing,
	} from '../../../../../lib/infrastructure/document/nature-fields';
	import {
		newNodeFrom,
		type NodeFields,
		nodeFields,
	} from '../../../../../lib/infrastructure/document/node-fields';
	import {
		SharedCommandKind as Op,
		type SharedDocumentCommand,
		SharedElementKind as Kind,
	} from '../../../../../lib/infrastructure/document/shared-document-command';
	import {
		connectedNodeCreation,
		containerMove,
		deletion,
		groupCreation,
		groupDissolution,
		type GroupFields,
		groupFields,
		groupFoldToggle,
		groupStyleUpdate,
		junctionInsertion,
		junctionOperatorUpdate,
		layoutUpdate,
		relationCreation,
	} from '../../../document/document-commands';
	import { m } from '../../../i18n/paraglide/messages';
	import {
		translateCommandDiagnostics,
		translateSessionError,
	} from '../../../i18n/session-messages';
	import { createSharedCanvasProjection } from '../../../projection/open-document';
	import {
		deleteVisibleRelation,
		hiddenRelationFields,
	} from '../../../projection/visible-relation-commands';
	import { EntityKind, type EntityRef } from '../../canvas/canvas-entity';
	import type { CanvasModel } from '../../canvas/canvas-model';
	import { groupableNodeIds } from '../../canvas/group-edit';
	import { planJunctionInsertion } from '../../canvas/junction-insertion';
	import {
		type NodeCreationPlan,
		type NodeCreationRequest,
		planNodeCreation,
	} from '../../canvas/relative-node-creation';
	import { rootLanes } from '../../canvas/root-lanes';
	import { CanvasSession, type EditingCanvasActivity } from '../../session/canvas-session.svelte';
	import { createNodeEditPort } from '../../session/node-edit-port';
	import CanvasActions from '../canvas/CanvasActions.svelte';
	import CanvasGestures from '../canvas/CanvasGestures.svelte';
	import CanvasInteractionStatus from '../canvas/CanvasInteractionStatus.svelte';
	import CanvasViewportControls from '../canvas/CanvasViewportControls.svelte';
	import GroupDialog from '../canvas/GroupDialog.svelte';
	import JunctionDialog from '../canvas/JunctionDialog.svelte';
	import LanesDialog from '../canvas/LanesDialog.svelte';
	import LayoutChip from '../canvas/LayoutChip.svelte';
	import LogicCanvas from '../canvas/LogicCanvas.svelte';
	import NatureDialog from '../canvas/NatureDialog.svelte';
	import NodeDialog from '../canvas/NodeDialog.svelte';
	import NodeEditor from '../canvas/NodeEditor.svelte';
	import { sharedSelection } from './canvas-awareness';
	import CanvasAwareness from './CanvasAwareness.svelte';
	import {
		type CollaborationAwareness,
		setCollaborationAwareness,
	} from './collaboration-awareness.svelte';
	import SharedElementCard from './SharedElementCard.svelte';
	import SharedNodeFields from './SharedNodeFields.svelte';
	import SharedNodeText from './SharedNodeText.svelte';
	import SharedPropertyFields from './SharedPropertyFields.svelte';
	import SharedStructureControls from './SharedStructureControls.svelte';
	import SharedTextField from './SharedTextField.svelte';
	let {
		client,
		model,
		name,
		connected,
		textEditable,
		awareness,
		panel = true,
	}: {
		client: CollaborativeDocumentSession;
		model: LogicDocument;
		name: string;
		connected: boolean;
		textEditable: boolean;
		/** Owned by the session so that the page chrome shares the presence and follow state. */
		awareness: CollaborationAwareness;
		/** The shared-fields panel beside the canvas; the product shows the canvas alone. */
		panel?: boolean;
	} = $props();
	const canvas = new CanvasSession(createNodeEditPort(untrack(() => client)));
	setCollaborationAwareness(untrack(() => awareness));
	let error = $state('');
	/** The canvas viewport, where `?` opens the shortcuts panel. */
	let canvasViewport = $state<HTMLDivElement>();
	let creation = $state<{ plan: NodeCreationPlan; draft: NodeFields }>();
	let editingGroup = $state<{
		id: string;
		mode: 'name' | 'edit';
		base: GroupFields;
		draft: GroupFields;
	}>();
	/** The dialog waits for the room to publish the group, e.g. right after grouping. */
	let editedGroup = $derived(model.groups.find(({ id }) => id === editingGroup?.id));
	let groupable = $derived(groupableNodeIds(model, canvas.selection.values()));
	let editingJunction = $state<{ id: string; base: JunctionOperator; draft: JunctionOperator }>();
	/** As for groups, the dialog shows once the room has published the junction. */
	let editedJunction = $derived(model.junctions.find(({ id }) => id === editingJunction?.id));
	let lastOperator = $state<JunctionOperator>(Operator.Xor);
	let lastNatureId = $state<string>();
	let natureManager = $state(false);
	let lanesDialog = $state(false);
	let lanes = $derived(rootLanes(model));
	let editingNature = $state<NatureEditing>();
	/**
	 * An edited nature that a peer removed falls back to the list. Its label is live shared text,
	 * so the preview follows the room rather than the snapshot taken when the form opened.
	 */
	let editedNature = $derived.by((): NatureEditing | undefined => {
		const editing = editingNature;
		if (editing === undefined) return undefined;
		if (editing.mode === NatureEditingMode.Create) return editing;
		const nature = model.natures.find(({ id }) => id === editing.id);
		if (nature === undefined) return undefined;
		return {
			...editing,
			base: { ...editing.base, label: nature.label },
			draft: { ...editing.draft, label: nature.label },
		};
	});
	/** « Grouper » is offered only for a groupable selection. */
	let groupAction = $derived.by((): (() => void) | undefined => {
		if (groupable === undefined) return undefined;
		return groupSelection;
	});
	const projection = untrack(() => createSharedCanvasProjection(model));
	let sourceState = $state.raw(untrack(() => client.readSourceState()));
	let sourceValid = $derived(sourceState.kind === SourceDocumentStateKind.Valid);
	let interactive = $derived(
		connected &&
			sourceValid &&
			creation === undefined &&
			editingGroup === undefined &&
			editingJunction === undefined &&
			!natureManager &&
			!lanesDialog &&
			canvas.editing === undefined,
	);
	onMount(() => {
		const stop = client.subscribeToSourceState((state) => {
			sourceState = state;
			projection.updateSourceState(state);
		});
		const initial = client.readSourceState();
		sourceState = initial;
		projection.updateSourceState(initial);
		return stop;
	});
	let visible = $state.raw(projection.visible);
	$effect(() => {
		try {
			projection.update(model);
			visible = projection.visible;
			error = projection.warning ?? '';
		} catch (failure) {
			error = m.collaboration_workspace_collapsed_projection_failed({
				message: String(failure),
			});
		}
	});
	function dispatch(command: SharedDocumentCommand): void {
		dispatchMany([command]);
	}
	/** Returns whether the batch was proposed; the room's refusal surfaces later in `error`. */
	function dispatchMany(commands: readonly SharedDocumentCommand[]): boolean {
		if (!sourceValid) return false;
		let decision: Promise<DocumentCommandOutcome>;
		try {
			decision = client.dispatch(commands);
		} catch (failure) {
			error = translateSessionError(failure);
			return false;
		}
		error = '';
		void decision.then(reportRefusal);
		return true;
	}
	function reportRefusal(outcome: DocumentCommandOutcome): void {
		if (outcome.kind === DocumentCommandOutcomeKind.Rejected)
			error = translateCommandDiagnostics(outcome.diagnostics);
		else if (outcome.kind === DocumentCommandOutcomeKind.Failed)
			error = translateSessionError(outcome.error);
	}
	function connect(from: string, to: string) {
		if (!connected || !sourceValid) return;
		const relation = { id: crypto.randomUUID(), from, to };
		// Refuse a cycle locally rather than after a round trip to the room.
		const candidate = projectRelationAddition(model, relation, fractionalOrderKeySpace);
		if (!candidate.ok) {
			error = translateCommandDiagnostics(candidate.diagnostics);
			return;
		}
		dispatch(relationCreation(relation));
	}
	function moveSelection(ids: readonly string[], groupId: string | undefined) {
		if (!connected || !sourceValid) return;
		dispatch(containerMove(ids, groupId));
	}
	function deleteSelection() {
		if (!interactive || canvas.editing) return;
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
		const commands = deletion(model, endpointIds, relationIds, () => crypto.randomUUID());
		return commands.length > 0 && dispatchMany(commands);
	}
	function openCreation(request: NodeCreationRequest): void {
		if (!interactive) return;
		const plan = planNodeCreation(model, request, {
			nodeId: crypto.randomUUID(),
			relationId: () => crypto.randomUUID(),
			lastNatureId,
		});
		if (plan === undefined) {
			error = m.collaboration_workspace_nature_required();
			return;
		}
		error = '';
		creation = { plan, draft: nodeFields(plan.node) };
	}
	function submitCreation(): void {
		const current = creation;
		if (current === undefined || !connected || !sourceValid) return;
		const node = newNodeFrom(current.plan.node.id, current.draft, current.plan.node.groupId);
		if (!dispatchMany(connectedNodeCreation(node, current.plan.relations))) return;
		lastNatureId = current.draft.natureId;
		creation = undefined;
		canvas.clearSelection();
		canvas.addEntity({ kind: EntityKind.Node, id: node.id });
	}
	function openGroupEditor(groupId: string, mode: 'name' | 'edit' = 'edit'): void {
		const group = model.groups.find(({ id }) => id === groupId);
		let fields: GroupFields = { label: 'Groupe', color: '', laneId: '' };
		if (group !== undefined) fields = groupFields(group);
		editingGroup = { id: groupId, mode, base: fields, draft: fields };
	}
	function saveGroup(): void {
		const editing = editingGroup;
		if (editing === undefined) return;
		const style = groupStyleUpdate(editing.id, editing.base, editing.draft);
		if (style !== undefined && !dispatchMany([style])) return;
		editingGroup = undefined;
	}
	function dissolveGroup(groupId: string): void {
		if (!dispatchMany([groupDissolution(groupId)])) return;
		editingGroup = undefined;
		canvas.clearSelection();
	}
	function toggleGroup(groupId: string): void {
		const group = model.groups.find(({ id }) => id === groupId);
		if (group !== undefined) dispatchMany([groupFoldToggle(group)]);
	}
	/** Proposes the group, selects it, then names it once the room has published it. */
	function groupSelection(): void {
		const members = groupable;
		if (!interactive || members === undefined) return;
		const groupId = crypto.randomUUID();
		if (!dispatchMany([groupCreation(groupId, members)])) return;
		canvas.selectEntity({ kind: EntityKind.Group, id: groupId });
		openGroupEditor(groupId, 'name');
	}
	function openJunctionEditor(junctionId: string): void {
		const junction = model.junctions.find(({ id }) => id === junctionId);
		const operator = junction?.operator ?? lastOperator;
		editingJunction = { id: junctionId, base: operator, draft: operator };
	}
	function saveJunction(): void {
		const editing = editingJunction;
		if (editing === undefined) return;
		if (
			editing.draft !== editing.base &&
			!dispatchMany([junctionOperatorUpdate(editing.id, editing.draft)])
		)
			return;
		lastOperator = editing.draft;
		editingJunction = undefined;
	}
	/** Proposes the junction on the relation, selects it, then asks for its operator. */
	function insertJunction(relationId: string): void {
		if (!interactive) return;
		const plan = planJunctionInsertion(model, relationId, {
			junctionId: crypto.randomUUID(),
			relationId: () => crypto.randomUUID(),
			operator: lastOperator,
		});
		if (plan === undefined || !dispatchMany(junctionInsertion(model, plan))) return;
		canvas.selectEntity({ kind: EntityKind.Junction, id: plan.junction.id });
		openJunctionEditor(plan.junction.id);
	}
	function openNatures(): void {
		if (!interactive) return;
		editingNature = undefined;
		natureManager = true;
	}
	function closeNatures(): void {
		natureManager = false;
		editingNature = undefined;
	}
	function openLanes(): void {
		if (!interactive) return;
		lanesDialog = true;
	}
	function selectNature(natureId: string): void {
		const nature = model.natures.find(({ id }) => id === natureId);
		if (nature !== undefined) editingNature = natureEditing(nature);
	}
	/** The label of an existing nature is live shared text; only its style travels here. */
	function saveNature(): void {
		const editing = editingNature;
		if (editing === undefined) return;
		if (editing.mode === NatureEditingMode.Create) {
			if (!dispatchMany([natureCreation(editing.id, editing.draft)])) return;
		} else {
			const style = natureStyleUpdate(editing.id, editing.base, editing.draft);
			if (style !== undefined && !dispatchMany([style])) return;
		}
		editingNature = undefined;
	}
	function deleteNature(replacementId: string | undefined): void {
		const editing = editingNature;
		if (editing === undefined) return;
		if (dispatchMany([natureDeletion(editing.id, replacementId)])) editingNature = undefined;
	}

	$effect(() => {
		client.setPresence({
			name,
			color: `hsl(${client.document.clientID % 360} 65% 42%)`,
			selected: sharedSelection(canvas.selection.values()),
		});
	});
</script>

<div class="workspace" class:solo={!panel}>
	<div class="canvas">
		{#if !panel}
			<CanvasViewportControls session={canvas} viewportElement={canvasViewport} />
			<CanvasInteractionStatus session={canvas} />
			<div class="absolute top-7 left-1/2 z-20 -translate-x-1/2 print:hidden">
				<LayoutChip
					layout={model.layout}
					{lanes}
					disabled={!interactive}
					onchange={(layout: LayoutConfiguration) => {
						dispatch(layoutUpdate(layout));
					}}
					onlanes={openLanes}
				/>
			</div>
			{#if error}<p role="alert" class="ui-notice error absolute top-16 left-4 z-40 print:hidden">
					{error}
				</p>{/if}
		{/if}
		<CanvasActions
			enabled={interactive}
			oncreate={() => {
				openCreation({ near: canvas.relativeNodeCreationTarget });
			}}
			onnatures={openNatures}
		/>
		<CanvasGestures
			session={canvas}
			enabled={interactive}
			oncreate={openCreation}
			onconnect={connect}
			onmove={moveSelection}
			ondelete={deleteSelection}
		>
			<LogicCanvas
				document={projection}
				session={canvas}
				natures={model.natures}
				{lanes}
				oncanvas={(_model: CanvasModel, element: HTMLDivElement) => {
					canvasViewport = element;
				}}
				onGroup={groupAction}
				onDelete={deleteSelection}
				onGroupEdit={openGroupEditor}
				onGroupToggle={toggleGroup}
				onGroupDissolve={dissolveGroup}
				onJunctionEdit={openJunctionEditor}
				onRelationSplit={insertJunction}
				onCreateChild={(target: EntityRef) => {
					openCreation({ target });
				}}
			>
				{#snippet awareness(model, viewport)}<CanvasAwareness canvas={model} {viewport} />{/snippet}
				{#snippet editor(editing: EditingCanvasActivity)}
					{@const node = visible.document.nodes.find((item) => item.id === editing.nodeId)}
					<NodeEditor
						{editing}
						session={canvas}
						natures={model.natures}
						{lanes}
						description={m.collaboration_workspace_shared_node_description()}
					>
						{#snippet text()}
							{#if node}
								<div class="editor-step">
									<SharedNodeText
										{node}
										{client}
										{textEditable}
										label={m.collaboration_workspace_node_text_label({ id: editing.nodeId })}
										autofocusMarkdown
									/>
								</div>
							{:else}
								<label class="ui-label"
									>{m.collaboration_workspace_fallback_content_label()}<textarea
										class="ui-field"
										rows="5"
										aria-label={m.collaboration_workspace_fallback_content_aria({
											id: editing.nodeId,
										})}
										value={editing.draft.markdown}
										disabled></textarea></label
								>
								<label class="ui-label"
									>{m.collaboration_workspace_fallback_description_label()}<textarea
										class="ui-field"
										rows="3"
										aria-label={m.collaboration_workspace_fallback_description_aria({
											id: editing.nodeId,
										})}
										value={editing.draft.description}
										disabled></textarea></label
								>
							{/if}
						{/snippet}
					</NodeEditor>
				{/snippet}
			</LogicCanvas>
		</CanvasGestures>
		{#if sourceValid && editingGroup && editedGroup}
			{@const editing = editingGroup}
			{@const target = { kind: Kind.Group, id: editing.id } as const}
			<GroupDialog
				mode={editing.mode}
				draft={editing.draft}
				{lanes}
				description={m.collaboration_workspace_shared_group_description()}
				data={{ 'data-group-editor': editing.id }}
				onchange={(patch: Partial<GroupFields>) => {
					if (editingGroup !== undefined)
						editingGroup = { ...editingGroup, draft: { ...editingGroup.draft, ...patch } };
				}}
				onsubmit={saveGroup}
				onclose={() => {
					editingGroup = undefined;
				}}
				ondissolve={() => {
					dissolveGroup(editing.id);
				}}
			>
				{#snippet text()}
					{#key client.text(target, 'label')}
						<SharedTextField
							{client}
							connected={textEditable}
							{target}
							field="label"
							label={m.collaboration_workspace_group_title_label()}
							autofocus
						/>
					{/key}
				{/snippet}
			</GroupDialog>
		{/if}
		{#if sourceValid && editingJunction && editedJunction}
			{@const editing = editingJunction}
			<JunctionDialog
				operator={editing.draft}
				data={{ 'data-junction-editor': editing.id }}
				onchange={(operator: JunctionOperator) => {
					if (editingJunction !== undefined)
						editingJunction = { ...editingJunction, draft: operator };
				}}
				onsubmit={saveJunction}
				onclose={() => {
					editingJunction = undefined;
				}}
			/>
		{/if}
		{#if creation}<NodeDialog
				mode="create"
				natures={model.natures}
				{lanes}
				draft={creation.draft}
				onchange={(patch: Partial<NodeFields>) => {
					const current = creation;
					if (current !== undefined)
						creation = { ...current, draft: { ...current.draft, ...patch } };
				}}
				onsubmit={submitCreation}
				onclose={() => {
					creation = undefined;
				}}
			/>{/if}
		{#if sourceValid && lanesDialog}
			<LanesDialog
				document={model}
				onsubmit={(command: SharedDocumentCommand) => {
					if (dispatchMany([command])) lanesDialog = false;
				}}
				onclose={() => {
					lanesDialog = false;
				}}
			/>
		{/if}
		{#if sourceValid && natureManager}
			<NatureDialog
				natures={model.natures}
				usage={natureUsage(model)}
				editing={editedNature}
				description={m.collaboration_workspace_shared_nature_description()}
				data={{ 'data-nature-manager': '' }}
				onselect={selectNature}
				oncreate={() => {
					editingNature = newNatureEditing(crypto.randomUUID());
				}}
				onchange={(patch: Partial<NatureFields>) => {
					if (editingNature !== undefined)
						editingNature = { ...editingNature, draft: { ...editingNature.draft, ...patch } };
				}}
				onsubmit={saveNature}
				onback={() => {
					editingNature = undefined;
				}}
				ondelete={deleteNature}
				onclose={closeNatures}
			>
				{#snippet text()}
					{#if editedNature}
						{@const target = { kind: Kind.Nature, id: editedNature.id } as const}
						{#key client.text(target, 'label')}
							<SharedTextField
								{client}
								connected={textEditable}
								{target}
								field="label"
								label={m.collaboration_workspace_nature_label_label()}
								autofocus
							/>
						{/key}
					{/if}
				{/snippet}
			</NatureDialog>
		{/if}
	</div>
	{#if panel}<aside aria-label={m.collaboration_workspace_panel_aria()}>
			{#if !sourceValid}
				<p>{m.collaboration_workspace_invalid_source_notice()}</p>
			{:else}
				<SharedElementCard label={m.collaboration_workspace_document_title()}>
					<SharedTextField
						{client}
						connected={textEditable}
						target={{ kind: Kind.Document, id: model.id }}
						field="title"
						label={m.collaboration_workspace_document_title()}
					/>
				</SharedElementCard>
				<SharedStructureControls model={visible.document} {connected} {dispatch} />
				{#if error}<p role="alert">{error}</p>{/if}
				{#each visible.document.nodes as node (node.id)}
					<section aria-label={m.collaboration_workspace_node_section_aria({ id: node.id })}>
						<SharedElementCard label={m.collaboration_workspace_node_card_label({ id: node.id })}>
							<SharedNodeFields
								{node}
								{client}
								{connected}
								{textEditable}
								{dispatch}
								label={m.collaboration_workspace_node_content_label({ id: node.id })}
							/>
						</SharedElementCard>
					</section>
				{/each}
				{#each visible.document.groups as group (group.id)}
					<section aria-label={m.collaboration_workspace_group_section_aria({ id: group.id })}>
						<SharedElementCard label={m.collaboration_workspace_group_card_label({ id: group.id })}>
							{#key client.text({ kind: Kind.Group, id: group.id }, 'label')}
								<SharedTextField
									{client}
									connected={textEditable}
									target={{ kind: Kind.Group, id: group.id }}
									field="label"
									label={m.collaboration_workspace_group_label_field({ id: group.id })}
								/>
							{/key}
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
								}}>{m.collaboration_workspace_collapse_group({ id: group.id })}</button
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
								}}>{m.collaboration_workspace_expand_group({ id: group.id })}</button
							>
							<output aria-label={m.collaboration_workspace_group_state_aria({ id: group.id })}
								>{group.state ?? GroupState.Expanded}</output
							>
							<button
								type="button"
								disabled={!connected}
								onclick={() => {
									dispatch({ op: Op.Ungroup, id: group.id });
								}}>{m.collaboration_workspace_dissolve_group({ id: group.id })}</button
							>
						</SharedElementCard>
					</section>
				{/each}
				{#each model.natures as nature (nature.id)}
					<section aria-label={m.collaboration_workspace_nature_section_aria({ id: nature.id })}>
						<SharedElementCard
							label={m.collaboration_workspace_nature_card_label({ id: nature.id })}
						>
							{#key client.text({ kind: Kind.Nature, id: nature.id }, 'label')}
								<SharedTextField
									{client}
									connected={textEditable}
									target={{ kind: Kind.Nature, id: nature.id }}
									field="label"
									label={m.collaboration_workspace_nature_label_field({ id: nature.id })}
								/>
							{/key}
							<SharedPropertyFields
								target={{ kind: Kind.Nature, id: nature.id }}
								properties={{ color: nature.color, icon: nature.icon }}
								{connected}
								{dispatch}
							/>
						</SharedElementCard>
					</section>
				{/each}
				{#each visible.document.junctions as junction (junction.id)}
					<section
						aria-label={m.collaboration_workspace_junction_section_aria({ id: junction.id })}
					>
						<SharedElementCard
							label={m.collaboration_workspace_junction_card_label({ id: junction.id })}
						>
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
								}}>{m.collaboration_workspace_delete_junction({ id: junction.id })}</button
							>
						</SharedElementCard>
					</section>
				{/each}
				<ul aria-label={m.collaboration_workspace_relations_list_aria()}>
					{#each visible.document.relations as relation (relation.id)}
						{@const provenance = defined(visible.relations.get(relation.id))}
						<li>
							{relation.from} → {relation.to}
							<SharedElementCard
								label={m.collaboration_workspace_relation_card_label({ id: relation.id })}
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
									}}>{m.collaboration_workspace_delete_relation({ id: relation.id })}</button
								>
							</SharedElementCard>
						</li>{/each}
				</ul>
			{/if}
		</aside>{/if}
</div>

<style>
	.workspace {
		display: grid;
		grid-template-columns: minmax(240px, 1fr) 330px;
		flex: 1;
		min-height: 0;
	}
	.workspace.solo {
		grid-template-columns: minmax(0, 1fr);
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
		.workspace:not(.solo) {
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
	@media print {
		.workspace {
			display: block;
		}
		aside {
			display: none;
		}
	}
</style>
