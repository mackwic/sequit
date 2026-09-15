<script lang="ts">
	import type { LogicDocument, LogicGroup } from '../../../../../lib/core/document/logic-document';
	import { DocumentCommandOutcomeKind } from '../../../../../lib/infrastructure/document/document-command-contracts';
	import { openDocument } from '../../../projection/open-document';
	import { EntityKind } from '../../canvas/canvas-entity';
	import {
		planRelativeNodeCreation,
		type RelativeNodePosition,
	} from '../../canvas/relative-node-creation';
	import { CanvasSession } from '../../session/canvas-session.svelte';
	import CreateNodeDialog from '../collaboration/CreateNodeDialog.svelte';
	import CanvasGestures from './CanvasGestures.svelte';
	import CanvasInteractionStatus from './CanvasInteractionStatus.svelte';
	import CanvasToolbar from './CanvasToolbar.svelte';
	import CanvasViewportControls from './CanvasViewportControls.svelte';
	import GroupEditDialog from './GroupEditDialog.svelte';
	import LogicCanvas from './LogicCanvas.svelte';

	let { source }: { source: string } = $props();
	let opened = $derived(openDocument(source));
	let creating = $state(false);
	let editingGroup = $state<LogicGroup>();
	let creationGroupId = $state<string>();
	let lastNatureId = $state<string>();
	function creationParent(): { groupId?: string } {
		if (creationGroupId === undefined) return {};
		return { groupId: creationGroupId };
	}
	let busy = $state(false);
	let error = $state('');
	async function execute(action: () => Promise<LogicDocument>): Promise<boolean> {
		busy = true;
		try {
			await action();
			error = '';
			creating = false;
			return true;
		} catch (failure) {
			error = String(failure);
			return false;
		} finally {
			busy = false;
		}
	}
	function createNode(natureId: string, markdown: string) {
		const current = opened;
		lastNatureId = natureId;
		if (current.ok)
			void execute(() =>
				current.value.addNode({ id: crypto.randomUUID(), natureId, markdown, ...creationParent() }),
			);
	}
	async function createRelativeNode(position: RelativeNodePosition): Promise<void> {
		const current = opened;
		const target = session?.relativeNodeCreationTarget;
		if (!current.ok || !session || target === undefined || busy) return;
		busy = true;
		try {
			if (session.editing) {
				const save = await session.saveDraft(false);
				if (save?.kind !== DocumentCommandOutcomeKind.Accepted) return;
			}
			const plan = planRelativeNodeCreation(current.value.read(), target, position, {
				nodeId: crypto.randomUUID(),
				relationId: () => crypto.randomUUID(),
				lastNatureId,
			});
			if (plan === undefined) throw new Error('Ajoutez d’abord une nature au document.');
			await current.value.addConnectedNode(plan.node, plan.relations);
			lastNatureId = plan.node.natureId;
			session.queueNodeMarkdownEdit(plan.node, () => {
				void execute(() => current.value.deleteElements([plan.node.id], []));
			});
			error = '';
		} catch (failure) {
			error = String(failure);
		} finally {
			busy = false;
		}
	}
	function connect(from: string, to: string) {
		const current = opened;
		if (current.ok)
			void execute(() => current.value.addRelation({ id: crypto.randomUUID(), from, to }));
	}
	function openGroupEditor(groupId: string): void {
		const current = opened;
		if (!current.ok) return;
		editingGroup = current.value.read().groups.find(({ id }) => id === groupId);
	}
	async function saveGroup(label: string, color: string): Promise<void> {
		const current = opened;
		const group = editingGroup;
		if (!current.ok || group === undefined || busy) return;
		const saved = await execute(() => current.value.updateGroup({ ...group, label, color }));
		if (saved) editingGroup = undefined;
	}
	function deleteSelection() {
		const current = opened;
		if (!current.ok || !session) return;
		const selected = [...session.selection.values()];
		void execute(() =>
			current.value.deleteElements(
				selected.filter(({ kind }) => kind !== EntityKind.Relation).map(({ id }) => id),
				selected.filter(({ kind }) => kind === EntityKind.Relation).map(({ id }) => id),
			),
		);
	}
	async function groupSelection(): Promise<void> {
		const current = opened;
		if (!current.ok || !session) return;
		const nodeIds = [...session.selection.values()]
			.filter(({ kind }) => kind === EntityKind.Node)
			.map(({ id }) => id);
		if (nodeIds.length < 2 || nodeIds.length !== session.selectionCount) return;
		const grouped = await execute(() =>
			current.value.groupNodes({ id: crypto.randomUUID(), label: 'Groupe' }, nodeIds),
		);
		if (grouped) session.clearSelection();
	}
	let session = $derived.by(() => {
		if (!opened.ok) return undefined;
		return new CanvasSession(opened.value);
	});

	$effect(() => {
		const current = opened;
		if (!current.ok) return;
		return () => {
			current.value.destroy();
		};
	});
</script>

<section class="relative min-h-0 flex-1 overflow-hidden" aria-label="Logic canvas">
	{#if opened.ok && session}
		<CanvasGestures
			{session}
			enabled={!creating && editingGroup === undefined && !busy}
			oncreate={(groupId: string | undefined) => {
				creationGroupId = groupId;
				creating = true;
			}}
			onconnect={connect}
			ondelete={deleteSelection}
			oncreaterelative={(position: RelativeNodePosition) => {
				void createRelativeNode(position);
			}}
		>
			<LogicCanvas
				document={opened.value}
				{session}
				onGroupEdit={openGroupEditor}
				onGroup={() => {
					void groupSelection();
				}}
			/>
		</CanvasGestures>
		{#if editingGroup}<GroupEditDialog
				group={editingGroup}
				saving={busy}
				onclose={() => {
					editingGroup = undefined;
				}}
				onsave={(label: string, color: string) => {
					void saveGroup(label, color);
				}}
			/>{/if}
		{#if creating}<CreateNodeDialog
				natures={opened.value.read().natures}
				connected={!busy}
				onclose={() => {
					creating = false;
				}}
				oncreate={createNode}
			/>{/if}
		{#if error}<p
				role="alert"
				class="absolute top-16 left-4 z-40 rounded-lg bg-red-50 p-4 text-red-800"
			>
				{error}
			</p>{/if}
		<CanvasToolbar {session} />
		<CanvasViewportControls {session} />
		<CanvasInteractionStatus {session} />
	{:else if !opened.ok}
		<div class="canvas-grid absolute inset-0 overflow-auto">
			<p class="m-8 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
				{opened.diagnostics.map(({ message }) => message).join('\n')}
			</p>
		</div>
	{/if}

	<div class="pointer-events-none absolute top-7 left-1/2 z-20 -translate-x-1/2">
		<div
			class="rounded-full border border-stone-200 bg-white px-3 py-1 text-xs font-medium text-stone-500 shadow-sm"
		>
			Auto-layout · Top to bottom
		</div>
	</div>
</section>

<style>
	.canvas-grid {
		background-color: #f5f5f4;
		background-image: radial-gradient(#d6d3d1 0.8px, transparent 0.8px);
		background-size: 20px 20px;
	}
</style>
