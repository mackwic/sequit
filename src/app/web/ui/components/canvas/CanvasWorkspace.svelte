<script lang="ts">
	import type { LogicGroup } from '../../../../../lib/core/document/logic-document';
	import {
		type DocumentCommandOutcome,
		DocumentCommandOutcomeKind,
	} from '../../../../../lib/infrastructure/document/document-command-contracts';
	import {
		SharedCommandKind,
		SharedElementKind,
	} from '../../../../../lib/infrastructure/document/shared-document-command';
	import {
		connectedNodeCreation,
		deletion,
		nodeCreation,
		relationCreation,
	} from '../../../document/document-commands';
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
	let interactive = $derived(!creating && editingGroup === undefined && !busy);
	/** The refusal or failure a user must see, or `undefined` once the batch is accepted. */
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
				current.value.session.dispatch([
					nodeCreation({ id: crypto.randomUUID(), natureId, markdown, ...creationParent() }),
				]),
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
			const refusal = outcomeError(
				await current.value.session.dispatch(connectedNodeCreation(plan.node, plan.relations)),
			);
			if (refusal !== undefined) {
				error = refusal;
				return;
			}
			lastNatureId = plan.node.natureId;
			session.queueNodeMarkdownEdit(plan.node, () => {
				void execute(() =>
					current.value.session.dispatch(deletion(current.value.read(), [plan.node.id], [])),
				);
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
			void execute(() =>
				current.value.session.dispatch([relationCreation({ id: crypto.randomUUID(), from, to })]),
			);
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
		const target = { kind: SharedElementKind.Group, id: group.id } as const;
		const saved = await execute(() => {
			if (!current.value.session.updateText(target, 'label', label))
				throw new Error(`Group no longer exists: ${group.id}`);
			return current.value.session.dispatch([
				{ op: SharedCommandKind.Update, target, set: { color }, unset: [] },
			]);
		});
		if (saved) editingGroup = undefined;
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
	async function groupSelection(): Promise<void> {
		const current = opened;
		if (!current.ok || !session) return;
		const members = [...session.selection.values()]
			.filter(({ kind }) => kind === EntityKind.Node)
			.map(({ id }) => id);
		if (members.length < 2 || members.length !== session.selectionCount) return;
		const grouped = await execute(() =>
			current.value.session.dispatch([
				{ op: SharedCommandKind.Group, id: crypto.randomUUID(), label: 'Groupe', members },
			]),
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
			enabled={interactive}
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
				onDelete={deleteSelection}
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
