<script lang="ts">
	import type { LogicDocument } from '../../../../../lib/core/document/logic-document';
	import {
		type DocumentCommandOutcome,
		DocumentCommandOutcomeKind,
	} from '../../../../../lib/infrastructure/document/document-command-contracts';
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
		relationCreation,
	} from '../../../document/document-commands';
	import { openDocument, type OpenDocumentResult } from '../../../projection/open-document';
	import { EntityKind } from '../../canvas/canvas-entity';
	import { groupableNodeIds } from '../../canvas/group-edit';
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
	import CanvasViewportControls from './CanvasViewportControls.svelte';
	import GroupDialog from './GroupDialog.svelte';
	import LogicCanvas from './LogicCanvas.svelte';
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
	let lastNatureId = $state<string>();
	let busy = $state(false);
	let error = $state('');
	let model = $state.raw<LogicDocument>();
	let layoutDirection = $derived(model?.layout.direction);
	let natures = $derived(model?.natures ?? []);
	let interactive = $derived(creation === undefined && editingGroup === undefined && !busy);
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
	let session = $derived.by(() => {
		if (!opened.ok) return undefined;
		return new CanvasSession(opened.value);
	});

	$effect(() => {
		const current = opened;
		if (!current.ok) {
			model = undefined;
			onopened?.(undefined);
			return;
		}
		onopened?.(current.value);
		model = current.value.read();
		const stop = current.value.subscribe(() => {
			model = current.value.read();
		});
		return () => {
			stop();
			current.value.destroy();
		};
	});
</script>

<section class="relative min-h-0 flex-1 overflow-hidden" aria-label="Canvas logique">
	{#if opened.ok && session}
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
