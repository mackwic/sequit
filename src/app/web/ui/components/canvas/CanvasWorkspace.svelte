<script lang="ts">
	import {
		type JunctionOperator,
		JunctionOperator as Operator,
		type LogicDocument,
	} from '../../../../../lib/core/document/logic-document';
	import {
		type DocumentCommandOutcome,
		DocumentCommandOutcomeKind,
	} from '../../../../../lib/infrastructure/document/document-command-contracts';
	import type { DocumentHistoryAvailability } from '../../../../../lib/infrastructure/document/document-session-contracts';
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
	import { SharedElementKind } from '../../../../../lib/infrastructure/document/shared-document-command';
	import {
		connectedNodeCreation,
		deletion,
		groupCreation,
		groupDissolution,
		type GroupFields,
		groupFields,
		groupFoldToggle,
		groupStyleUpdate,
		junctionInsertion,
		junctionOperatorUpdate,
		relationCreation,
	} from '../../../document/document-commands';
	import { openDocument, type OpenDocumentResult } from '../../../projection/open-document';
	import { EntityKind } from '../../canvas/canvas-entity';
	import { CANVAS_SHORTCUTS, CanvasShortcutId } from '../../canvas/canvas-shortcuts';
	import { groupableNodeIds } from '../../canvas/group-edit';
	import { planJunctionInsertion } from '../../canvas/junction-insertion';
	import { layoutDirectionLabels } from '../../canvas/layout-direction-labels';
	import {
		type NodeCreationPlan,
		type NodeCreationRequest,
		planNodeCreation,
	} from '../../canvas/relative-node-creation';
	import { CanvasSession } from '../../session/canvas-session.svelte';
	import CanvasActions from './CanvasActions.svelte';
	import CanvasGestures from './CanvasGestures.svelte';
	import CanvasInteractionStatus from './CanvasInteractionStatus.svelte';
	import CanvasShortcut from './CanvasShortcut.svelte';
	import CanvasViewportControls from './CanvasViewportControls.svelte';
	import GroupDialog from './GroupDialog.svelte';
	import JunctionDialog from './JunctionDialog.svelte';
	import LogicCanvas from './LogicCanvas.svelte';
	import NatureDialog from './NatureDialog.svelte';
	import NodeDialog from './NodeDialog.svelte';

	let {
		source,
		onopened,
	}: {
		source: string;
		/** Receives the opened document, or `undefined` while the source is invalid. */
		onopened?: ((document: OpenedDocument | undefined) => void) | undefined;
	} = $props();
	type OpenedDocument = Extract<OpenDocumentResult, { ok: true }>['value'];
	let opened = $derived(openDocument(source));
	let creation = $state<{ plan: NodeCreationPlan; draft: NodeFields }>();
	let editingGroup = $state<{
		id: string;
		mode: 'name' | 'edit';
		base: GroupFields;
		draft: GroupFields;
	}>();
	let editingJunction = $state<{ id: string; base: JunctionOperator; draft: JunctionOperator }>();
	let natureManager = $state(false);
	let editingNature = $state<NatureEditing>();
	let lastOperator = $state<JunctionOperator>(Operator.Xor);
	let lastNatureId = $state<string>();
	let busy = $state(false);
	let error = $state('');
	let model = $state.raw<LogicDocument>();
	let history = $state<DocumentHistoryAvailability>({ undo: false, redo: false });
	let layoutDirection = $derived(model?.layout.direction);
	let natures = $derived(model?.natures ?? []);
	let interactive = $derived(
		creation === undefined &&
			editingGroup === undefined &&
			editingJunction === undefined &&
			!natureManager &&
			!busy,
	);
	let groupable = $derived.by(() => {
		if (model === undefined || session === undefined) return undefined;
		return groupableNodeIds(model, session.selection.values());
	});
	/** « Grouper » is offered only for a groupable selection. */
	let groupAction = $derived.by((): (() => void) | undefined => {
		if (groupable === undefined) return undefined;
		return () => {
			void groupSelection();
		};
	});
	function outcomeError(outcome: DocumentCommandOutcome): string | undefined {
		if (outcome.kind === DocumentCommandOutcomeKind.Accepted) return undefined;
		if (outcome.kind === DocumentCommandOutcomeKind.Failed) return String(outcome.error);
		return outcome.diagnostics.map(({ message }) => message).join('; ');
	}
	async function execute(action: () => Promise<DocumentCommandOutcome>): Promise<boolean> {
		busy = true;
		try {
			const refusal = outcomeError(await action());
			if (refusal !== undefined) {
				error = refusal;
				return false;
			}
			error = '';
			return true;
		} catch (failure) {
			error = failureMessage(failure);
			return false;
		} finally {
			busy = false;
		}
	}
	function openCreation(request: NodeCreationRequest): void {
		const current = opened;
		if (!current.ok || busy) return;
		const plan = planNodeCreation(current.value.read(), request, {
			nodeId: crypto.randomUUID(),
			relationId: () => crypto.randomUUID(),
			lastNatureId,
		});
		if (plan === undefined) {
			error = 'Ajoutez d’abord une nature au document.';
			return;
		}
		error = '';
		creation = { plan, draft: nodeFields(plan.node) };
	}
	async function createBox(): Promise<void> {
		const current = opened;
		const canvas = session;
		const pending = creation;
		if (!current.ok || canvas === undefined || pending === undefined || busy) return;
		const saved = await execute(() =>
			current.value.session.dispatch(
				connectedNodeCreation(
					newNodeFrom(pending.plan.node.id, pending.draft, pending.plan.node.groupId),
					pending.plan.relations,
				),
			),
		);
		if (!saved) return;
		creation = undefined;
		lastNatureId = pending.draft.natureId;
		canvas.selectEntity({ kind: EntityKind.Node, id: pending.plan.node.id });
	}
	function failureMessage(failure: unknown): string {
		if (failure instanceof Error) return failure.message;
		return String(failure);
	}
	function connect(from: string, to: string) {
		const current = opened;
		if (current.ok)
			void execute(() =>
				current.value.session.dispatch([relationCreation({ id: crypto.randomUUID(), from, to })]),
			);
	}
	function openGroupEditor(groupId: string, mode: 'name' | 'edit' = 'edit'): void {
		const current = opened;
		if (!current.ok) return;
		const group = current.value.read().groups.find(({ id }) => id === groupId);
		if (group === undefined) return;
		const fields = groupFields(group);
		editingGroup = { id: groupId, mode, base: fields, draft: fields };
	}
	async function saveGroup(): Promise<void> {
		const current = opened;
		const editing = editingGroup;
		if (!current.ok || editing === undefined || busy) return;
		const target = { kind: SharedElementKind.Group, id: editing.id } as const;
		const label = editing.draft.label.trim();
		const saved = await execute(() => {
			if (label !== editing.base.label && !current.value.session.updateText(target, 'label', label))
				throw new Error(`Group no longer exists: ${editing.id}`);
			const style = groupStyleUpdate(editing.id, editing.base, editing.draft);
			if (style === undefined)
				return Promise.resolve({
					kind: DocumentCommandOutcomeKind.Accepted,
					document: current.value.read(),
				});
			return current.value.session.dispatch([style]);
		});
		if (saved) editingGroup = undefined;
	}
	async function dissolveGroup(groupId: string): Promise<void> {
		const current = opened;
		if (!current.ok || !session || busy) return;
		const dissolved = await execute(() =>
			current.value.session.dispatch([groupDissolution(groupId)]),
		);
		if (!dissolved) return;
		editingGroup = undefined;
		session.clearSelection();
	}
	function toggleGroup(groupId: string): void {
		const current = opened;
		if (!current.ok || busy) return;
		const group = current.value.read().groups.find(({ id }) => id === groupId);
		if (group === undefined) return;
		void execute(() => current.value.session.dispatch([groupFoldToggle(group)]));
	}
	function deleteSelection() {
		const current = opened;
		if (!current.ok || !session || !interactive) return;
		const selected = [...session.selection.values()];
		void execute(() =>
			current.value.session.dispatch(
				deletion(
					current.value.read(),
					selected.filter(({ kind }) => kind !== EntityKind.Relation).map(({ id }) => id),
					selected.filter(({ kind }) => kind === EntityKind.Relation).map(({ id }) => id),
				),
			),
		);
	}
	/** Creates the group, selects it, then opens its dialog so the author names it. */
	async function groupSelection(): Promise<void> {
		const current = opened;
		const members = groupable;
		if (!current.ok || !session || members === undefined || busy) return;
		const groupId = crypto.randomUUID();
		const grouped = await execute(() =>
			current.value.session.dispatch([groupCreation(groupId, members)]),
		);
		if (!grouped) return;
		session.selectEntity({ kind: EntityKind.Group, id: groupId });
		openGroupEditor(groupId, 'name');
	}
	function openJunctionEditor(junctionId: string): void {
		const current = opened;
		if (!current.ok) return;
		const junction = current.value.read().junctions.find(({ id }) => id === junctionId);
		if (junction === undefined) return;
		editingJunction = { id: junctionId, base: junction.operator, draft: junction.operator };
	}
	async function saveJunction(): Promise<void> {
		const current = opened;
		const editing = editingJunction;
		if (!current.ok || editing === undefined || busy) return;
		if (editing.draft !== editing.base) {
			const saved = await execute(() =>
				current.value.session.dispatch([junctionOperatorUpdate(editing.id, editing.draft)]),
			);
			if (!saved) return;
		}
		lastOperator = editing.draft;
		editingJunction = undefined;
	}
	/** Threads a junction through the relation, selects it, then asks for its operator. */
	async function insertJunction(relationId: string): Promise<void> {
		const current = opened;
		if (!current.ok || !session || busy) return;
		const plan = planJunctionInsertion(current.value.read(), relationId, {
			junctionId: crypto.randomUUID(),
			relationId: () => crypto.randomUUID(),
			operator: lastOperator,
		});
		if (plan === undefined) return;
		const inserted = await execute(() => current.value.session.dispatch(junctionInsertion(plan)));
		if (!inserted) return;
		session.selectEntity({ kind: EntityKind.Junction, id: plan.junction.id });
		openJunctionEditor(plan.junction.id);
	}
	function openNatures(): void {
		if (!opened.ok || busy) return;
		editingNature = undefined;
		natureManager = true;
	}
	function closeNatures(): void {
		natureManager = false;
		editingNature = undefined;
	}
	function selectNature(natureId: string): void {
		const nature = model?.natures.find(({ id }) => id === natureId);
		if (nature !== undefined) editingNature = natureEditing(nature);
	}
	async function saveNature(): Promise<void> {
		const current = opened;
		const editing = editingNature;
		if (!current.ok || editing === undefined || busy) return;
		if (editing.mode === NatureEditingMode.Create) {
			const created = await execute(() =>
				current.value.session.dispatch([natureCreation(editing.id, editing.draft)]),
			);
			if (created) editingNature = undefined;
			return;
		}
		const target = { kind: SharedElementKind.Nature, id: editing.id } as const;
		const label = editing.draft.label.trim();
		const saved = await execute(() => {
			if (label !== editing.base.label && !current.value.session.updateText(target, 'label', label))
				throw new Error(`Nature no longer exists: ${editing.id}`);
			const style = natureStyleUpdate(editing.id, editing.base, editing.draft);
			if (style === undefined)
				return Promise.resolve({
					kind: DocumentCommandOutcomeKind.Accepted,
					document: current.value.read(),
				});
			return current.value.session.dispatch([style]);
		});
		if (saved) editingNature = undefined;
	}
	async function deleteNature(replacementId: string | undefined): Promise<void> {
		const current = opened;
		const editing = editingNature;
		if (!current.ok || editing === undefined || busy) return;
		const removed = await execute(() =>
			current.value.session.dispatch([natureDeletion(editing.id, replacementId)]),
		);
		if (removed) editingNature = undefined;
	}
	let session = $derived.by(() => {
		if (!opened.ok) return undefined;
		return new CanvasSession(opened.value);
	});

	$effect(() => {
		const current = opened;
		if (!current.ok) {
			model = undefined;
			history = { undo: false, redo: false };
			onopened?.(undefined);
			return;
		}
		onopened?.(current.value);
		model = current.value.read();
		const stop = current.value.subscribe(() => {
			model = current.value.read();
		});
		const sessionHistory = current.value.session.history;
		history = sessionHistory?.availability() ?? { undo: false, redo: false };
		const stopHistory = sessionHistory?.subscribe((availability) => {
			history = availability;
		});
		return () => {
			stop();
			stopHistory?.();
			current.value.destroy();
		};
	});
	/** History steps publish like any change; nothing else to refresh. */
	function undo(): void {
		if (!opened.ok || !interactive) return;
		opened.value.session.history?.undo();
	}
	function redo(): void {
		if (!opened.ok || !interactive) return;
		opened.value.session.history?.redo();
	}
</script>

<section class="relative min-h-0 flex-1 overflow-hidden" aria-label="Canvas logique">
	{#if opened.ok && session}
		<CanvasShortcut
			shortcut={CANVAS_SHORTCUTS[CanvasShortcutId.Undo]}
			enabled={interactive && history.undo}
			onactivate={undo}
		/>
		<CanvasShortcut
			shortcut={CANVAS_SHORTCUTS[CanvasShortcutId.Redo]}
			enabled={interactive && history.redo}
			onactivate={redo}
		/>
		<CanvasGestures
			{session}
			enabled={interactive}
			oncreate={openCreation}
			onconnect={connect}
			ondelete={deleteSelection}
		>
			<LogicCanvas
				document={opened.value}
				{natures}
				{session}
				onGroupEdit={openGroupEditor}
				onGroupToggle={toggleGroup}
				onGroupDissolve={(groupId: string) => {
					void dissolveGroup(groupId);
				}}
				onJunctionEdit={openJunctionEditor}
				onRelationSplit={(relationId: string) => {
					void insertJunction(relationId);
				}}
				onDelete={deleteSelection}
				onGroup={groupAction}
			/>
		</CanvasGestures>
		{#if editingGroup}
			{@const editing = editingGroup}
			<GroupDialog
				mode={editing.mode}
				draft={editing.draft}
				{busy}
				data={{ 'data-group-editor': editing.id }}
				onchange={(patch: Partial<GroupFields>) => {
					if (editingGroup !== undefined)
						editingGroup = { ...editingGroup, draft: { ...editingGroup.draft, ...patch } };
				}}
				onclose={() => {
					editingGroup = undefined;
				}}
				onsubmit={() => {
					void saveGroup();
				}}
				ondissolve={() => {
					void dissolveGroup(editing.id);
				}}
			/>
		{/if}
		{#if editingJunction}
			{@const editing = editingJunction}
			<JunctionDialog
				operator={editing.draft}
				{busy}
				data={{ 'data-junction-editor': editing.id }}
				onchange={(operator: JunctionOperator) => {
					if (editingJunction !== undefined)
						editingJunction = { ...editingJunction, draft: operator };
				}}
				onclose={() => {
					editingJunction = undefined;
				}}
				onsubmit={() => {
					void saveJunction();
				}}
			/>
		{/if}
		{#if creation}
			<NodeDialog
				mode="create"
				{natures}
				draft={creation.draft}
				{busy}
				data={{ 'data-node-creator': creation.plan.node.id }}
				onchange={(patch: Partial<NodeFields>) => {
					if (creation !== undefined)
						creation = { ...creation, draft: { ...creation.draft, ...patch } };
				}}
				onclose={() => {
					creation = undefined;
				}}
				onsubmit={createBox}
			/>
		{/if}
		{#if natureManager && model}
			<NatureDialog
				{natures}
				usage={natureUsage(model)}
				editing={editingNature}
				{busy}
				data={{ 'data-nature-manager': '' }}
				onselect={selectNature}
				oncreate={() => {
					editingNature = newNatureEditing(crypto.randomUUID());
				}}
				onchange={(patch: Partial<NatureFields>) => {
					if (editingNature !== undefined)
						editingNature = { ...editingNature, draft: { ...editingNature.draft, ...patch } };
				}}
				onsubmit={() => {
					void saveNature();
				}}
				onback={() => {
					editingNature = undefined;
				}}
				ondelete={(replacementId: string | undefined) => {
					void deleteNature(replacementId);
				}}
				onclose={closeNatures}
			/>
		{/if}
		{#if error}<p role="alert" class="ui-notice error absolute top-16 left-4 z-40">
				{error}
			</p>{/if}
		<CanvasViewportControls {session} />
		<CanvasActions
			{session}
			enabled={interactive}
			oncreate={() => {
				openCreation({ target: session.relativeNodeCreationTarget });
			}}
			onnatures={openNatures}
		/>
		<CanvasInteractionStatus {session} />
	{:else if !opened.ok}
		<div class="canvas-grid absolute inset-0 overflow-auto">
			<p class="ui-notice error m-8 text-sm">
				{opened.diagnostics.map(({ message }) => message).join('\n')}
			</p>
		</div>
	{/if}

	{#if layoutDirection}
		<div class="pointer-events-none absolute top-7 left-1/2 z-20 -translate-x-1/2">
			<p
				class="rounded-full border border-[var(--ui-border)] bg-[var(--ui-surface)] px-3 py-1 text-xs font-medium text-[var(--ui-muted)] shadow-sm"
			>
				Disposition automatique · {layoutDirectionLabels[layoutDirection]}
			</p>
		</div>
	{/if}
</section>

<style>
	.canvas-grid {
		background-color: #f5f5f4;
		background-image: radial-gradient(#d6d3d1 0.8px, transparent 0.8px);
		background-size: 20px 20px;
	}
</style>
