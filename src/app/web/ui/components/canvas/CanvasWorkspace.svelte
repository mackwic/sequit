<script lang="ts">
	import { tick, untrack } from 'svelte';

	import {
		type JunctionOperator,
		JunctionOperator as Operator,
		type LayoutConfiguration,
		type LogicDocument,
	} from '../../../../../lib/core/document/logic-document';
	import { firstNature, type NatureFamily } from '../../../../../lib/core/document/nature-families';
	import {
		type DocumentCommandOutcome,
		DocumentCommandOutcomeKind,
	} from '../../../../../lib/infrastructure/document/document-command-contracts';
	import type { DocumentHistoryAvailability } from '../../../../../lib/infrastructure/document/document-session-contracts';
	import {
		natureAfterRemoval,
		natureCreation,
		natureDeletion,
		type NatureEditing,
		natureEditing,
		NatureEditingMode,
		natureFamilyImport,
		type NatureFields,
		natureUpdate,
		natureUsage,
		newNatureEditing,
	} from '../../../../../lib/infrastructure/document/nature-fields';
	import {
		type SharedDocumentCommand,
		SharedElementKind,
	} from '../../../../../lib/infrastructure/document/shared-document-command';
	import {
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
		nodeNatureUpdate,
		relationCreation,
	} from '../../../document/document-commands';
	import {
		type NodePasteDestination,
		parseNodeClipboard,
		planNodePaste,
		selectionPasteDestination,
		serializeSelectedNodes,
	} from '../../../document/node-clipboard';
	import { m } from '../../../i18n/paraglide/messages';
	import {
		translateCommandDiagnostics,
		translateSessionError,
	} from '../../../i18n/session-messages';
	import { openDocument, type OpenDocumentResult } from '../../../projection/open-document';
	import { EntityKind, type EntityRef } from '../../canvas/canvas-entity';
	import type { CanvasModel, RenderedCanvasNode } from '../../canvas/canvas-model';
	import { CANVAS_SHORTCUTS, CanvasShortcutId } from '../../canvas/canvas-shortcuts';
	import { groupableNodeIds } from '../../canvas/group-edit';
	import { planJunctionInsertion } from '../../canvas/junction-insertion';
	import type { NodeCreationRequest } from '../../canvas/relative-node-creation';
	import { rootLanes } from '../../canvas/root-lanes';
	import type { LayoutReportRequest } from '../../report/capture-layout-report';
	import { CanvasSession } from '../../session/canvas-session.svelte';
	import CanvasActions from './CanvasActions.svelte';
	import CanvasGestures from './CanvasGestures.svelte';
	import CanvasInteractionStatus from './CanvasInteractionStatus.svelte';
	import CanvasShortcut from './CanvasShortcut.svelte';
	import CanvasViewportControls from './CanvasViewportControls.svelte';
	import GroupDialog from './GroupDialog.svelte';
	import JunctionDialog from './JunctionDialog.svelte';
	import LanesDialog from './LanesDialog.svelte';
	import LayoutChip from './LayoutChip.svelte';
	import LogicCanvas from './LogicCanvas.svelte';
	import NatureDialog from './NatureDialog.svelte';
	import { NodeTyping } from './node-typing.svelte';

	let {
		source,
		onopened,
		onexport,
		onexportimage,
		oncanvas,
	}: {
		source: string;
		/** Receives the opened document, or `undefined` while the source is invalid. */
		onopened?: ((document: OpenedDocument | undefined) => void) | undefined;
		/** The page's exports, also offered by the background menu of the canvas. */
		onexport?: (() => void) | undefined;
		onexportimage?: (() => void) | undefined;
		/** Supplies the current laid-out canvas for editable scene exports. */
		oncanvas?: ((canvas: CanvasModel) => void) | undefined;
	} = $props();
	type OpenedDocument = Extract<OpenDocumentResult, { ok: true }>['value'];
	let opened = $derived(openDocument(source));
	let editingGroup = $state<{
		id: string;
		mode: 'name' | 'edit';
		base: GroupFields;
		draft: GroupFields;
	}>();
	let editingJunction = $state<{ id: string; base: JunctionOperator; draft: JunctionOperator }>();
	let natureManager = $state(false);
	let lanesDialog = $state(false);
	let editingNature = $state<NatureEditing>();
	let lastOperator = $state<JunctionOperator>(Operator.Xor);
	let busy = $state(false);
	let error = $state('');
	let model = $state.raw<LogicDocument>();
	let history = $state<DocumentHistoryAvailability>({ undo: false, redo: false });
	let layout = $derived(model?.layout);
	let natures = $derived(model?.natures ?? []);
	let lanes = $derived.by(() => {
		if (model === undefined) return [];
		return rootLanes(model);
	});
	let interactive = $derived(
		editingGroup === undefined &&
			editingJunction === undefined &&
			!natureManager &&
			!lanesDialog &&
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
	/** « Gérer les natures du document » is offered while the canvas takes commands. */
	let manageNaturesAction = $derived.by((): (() => void) | undefined => {
		if (!interactive) return undefined;
		return openNatures;
	});
	/** An empty canvas invites its first box while the canvas takes commands. */
	let startAction = $derived.by((): (() => void) | undefined => {
		if (!interactive) return undefined;
		return () => {
			openDraft({});
		};
	});
	function outcomeError(outcome: DocumentCommandOutcome): string | undefined {
		if (outcome.kind === DocumentCommandOutcomeKind.Accepted) return undefined;
		if (outcome.kind === DocumentCommandOutcomeKind.Failed)
			return translateSessionError(outcome.error);
		return translateCommandDiagnostics(outcome.diagnostics);
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
			error = translateSessionError(failure);
			return false;
		} finally {
			busy = false;
		}
	}
	/** Starts typing a box; only a document without nature refuses it with a notice. */
	function openDraft(request: NodeCreationRequest): void {
		if (busy || typing === undefined) return;
		if (typing.open(request)) error = '';
		else if (natures.length === 0) error = m.common_nature_required();
	}
	function connect(from: string, to: string) {
		const current = opened;
		if (current.ok)
			void execute(() =>
				current.value.session.dispatch([relationCreation({ id: crypto.randomUUID(), from, to })]),
			);
	}
	function moveSelection(ids: readonly string[], groupId: string | undefined) {
		const current = opened;
		if (current.ok)
			void execute(() => current.value.session.dispatch([containerMove(ids, groupId)]));
	}
	function changeNature(nodeId: string, natureId: string): void {
		const current = opened;
		if (current.ok && interactive)
			void execute(() => current.value.session.dispatch([nodeNatureUpdate(nodeId, natureId)]));
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
				throw new Error(m.canvas_group_gone({ id: editing.id }));
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
	function changeLayout(next: LayoutConfiguration): void {
		const current = opened;
		if (!current.ok || busy) return;
		void execute(() => current.value.session.dispatch([layoutUpdate(next)]));
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
					() => crypto.randomUUID(),
				),
			),
		);
	}
	function copyNodes(): string | undefined {
		const current = opened;
		if (!current.ok || !session || !interactive) return undefined;
		const value = serializeSelectedNodes(current.value.read(), session.selection.values());
		if (value !== undefined)
			session.announcement = m.canvas_nodes_copied({ count: session.selectionCount });
		return value;
	}
	async function copyNodesToClipboard(): Promise<void> {
		const value = copyNodes();
		if (value === undefined) return;
		try {
			await navigator.clipboard.writeText(value);
		} catch {
			error = m.canvas_clipboard_unavailable();
			if (session) session.announcement = error;
		}
	}
	async function pasteNodes(text: string, destination?: NodePasteDestination): Promise<void> {
		const current = opened;
		if (!current.ok || !session || !interactive) return;
		const document = current.value.read();
		const clipboard = parseNodeClipboard(text, document.id);
		const target = destination ?? selectionPasteDestination(document, session.selection.values());
		const plan = clipboard && planNodePaste(document, clipboard, target, () => crypto.randomUUID());
		if (plan === undefined) {
			error = m.canvas_clipboard_invalid();
			return;
		}
		const accepted = await execute(() => current.value.session.dispatch(plan.commands));
		if (!accepted) return;
		session.clearSelection();
		for (const id of plan.ids) session.addEntity({ kind: EntityKind.Node, id });
		session.announcement = m.canvas_nodes_pasted({ count: plan.ids.length });
	}
	async function pasteNodesFromClipboard(destination: NodePasteDestination): Promise<void> {
		try {
			const text = await navigator.clipboard.readText();
			await pasteNodes(text, destination);
		} catch {
			error = m.canvas_clipboard_unavailable();
		}
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
	/** Converges the relations on a junction, selects it, then asks for its operator. */
	async function insertJunction(relationIds: readonly string[]): Promise<void> {
		const current = opened;
		if (!current.ok || !session || busy) return;
		const plan = planJunctionInsertion(current.value.read(), relationIds, {
			junctionId: crypto.randomUUID(),
			relationId: () => crypto.randomUUID(),
			operator: lastOperator,
		});
		if (plan === undefined) return;
		const inserted = await execute(() =>
			current.value.session.dispatch(junctionInsertion(current.value.read(), plan)),
		);
		if (!inserted) return;
		session.selectEntity({ kind: EntityKind.Junction, id: plan.junction.id });
		openJunctionEditor(plan.junction.id);
	}
	function openNatures(): void {
		if (!opened.ok || busy) return;
		const first = model && firstNature(model.natures);
		editingNature = first && natureEditing(first);
		natureManager = true;
	}
	function closeNatures(): void {
		natureManager = false;
		editingNature = undefined;
	}
	function openLanes(): void {
		if (!opened.ok || busy) return;
		lanesDialog = true;
	}
	async function saveLanes(command: SharedDocumentCommand): Promise<void> {
		const current = opened;
		if (!current.ok || busy) return;
		const saved = await execute(() => current.value.session.dispatch([command]));
		if (saved) lanesDialog = false;
	}
	function selectNature(natureId: string): void {
		const nature = model?.natures.find(({ id }) => id === natureId);
		if (nature !== undefined) editingNature = natureEditing(nature);
	}
	/** Saves the form; the dialog then decides which nature it shows, or closes. */
	async function saveNature(): Promise<boolean> {
		const current = opened;
		const editing = editingNature;
		if (!current.ok || editing === undefined || busy) return false;
		if (editing.mode === NatureEditingMode.Create)
			return execute(() =>
				current.value.session.dispatch([natureCreation(editing.id, editing.draft)]),
			);
		const target = { kind: SharedElementKind.Nature, id: editing.id } as const;
		const label = editing.draft.label.trim();
		return execute(() => {
			if (label !== editing.base.label && !current.value.session.updateText(target, 'label', label))
				throw new Error(m.canvas_nature_gone({ id: editing.id }));
			const update = natureUpdate(editing.id, editing.base, editing.draft);
			if (update === undefined)
				return Promise.resolve({
					kind: DocumentCommandOutcomeKind.Accepted,
					document: current.value.read(),
				});
			return current.value.session.dispatch([update]);
		});
	}
	async function deleteNature(replacementId: string | undefined): Promise<void> {
		const current = opened;
		const editing = editingNature;
		if (!current.ok || editing === undefined || busy) return;
		const next = natureAfterRemoval(natures, editing.id, replacementId);
		const removed = await execute(() =>
			current.value.session.dispatch([natureDeletion(editing.id, replacementId)]),
		);
		if (removed) editingNature = next && natureEditing(next);
	}
	async function importNatures(family: NatureFamily): Promise<void> {
		const current = opened;
		const commands = natureFamilyImport(natures, family);
		if (!current.ok || commands.length === 0 || busy) return;
		await execute(() => current.value.session.dispatch(commands));
	}
	let session = $derived.by(() => {
		if (!opened.ok) return undefined;
		return new CanvasSession(opened.value);
	});
	/** The canvas viewport, where `?` opens the shortcuts panel. */
	let canvasViewport = $state<HTMLDivElement>();
	let canvasModel = $state.raw<CanvasModel>();
	let layoutReport = $state<LayoutReportRequest>();
	function openLayoutReport(opener: HTMLElement): void {
		if (!opened.ok) return;
		const current = opened.value;
		layoutReport = {
			read: () => current.read(),
			close: () => {
				layoutReport = undefined;
				void tick().then(() => {
					opener.focus();
				});
			},
		};
	}
	let typing = $derived.by(() => {
		const current = opened;
		const canvas = session;
		if (!current.ok || canvas === undefined) return undefined;
		return new NodeTyping({
			read: () => current.value.read(),
			submit: (commands) => execute(() => current.value.session.dispatch(commands)),
			session: canvas,
			canvas: () => canvasModel,
		});
	});
	$effect(() => {
		const current = opened;
		const drafts = typing?.drafts;
		// The canvas hears the drafts at once; what it updates is no dependency of this effect.
		if (current.ok && drafts !== undefined)
			untrack(() => {
				current.value.showDrafts(drafts);
			});
	});
	$effect(() => {
		if (model !== undefined) typing?.settle(model);
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
		const stop = current.value.subscribeToDocument(() => {
			model = current.value.read();
		});
		const sessionHistory = current.value.session.history;
		history = sessionHistory.availability();
		const stopHistory = sessionHistory.subscribe((availability) => {
			history = availability;
		});
		return () => {
			stop();
			stopHistory();
			current.value.destroy();
		};
	});
	/** History steps publish like any change; nothing else to refresh. */
	function undo(): void {
		if (!opened.ok || !interactive) return;
		opened.value.session.history.undo();
	}
	function redo(): void {
		if (!opened.ok || !interactive) return;
		opened.value.session.history.redo();
	}
</script>

<section
	class="relative min-h-0 flex-1 overflow-hidden print:overflow-visible"
	aria-label={m.canvas_workspace()}
>
	{#if opened.ok && session}
		{@const current = opened.value}
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
			read={() => current.read()}
			oncreate={openDraft}
			onconnect={connect}
			onmove={moveSelection}
			ondelete={deleteSelection}
			onCopyNodes={copyNodes}
			onPasteNodes={(text: string) => {
				void pasteNodes(text);
			}}
		>
			<LogicCanvas
				document={opened.value}
				{natures}
				{lanes}
				{session}
				draft={typing?.controls}
				onNodeType={(node: RenderedCanvasNode) => {
					if (interactive) typing?.typeInPlace(node);
				}}
				onNodeNature={changeNature}
				onStart={startAction}
				oncanvas={(canvas: CanvasModel, element: HTMLDivElement) => {
					canvasModel = canvas;
					canvasViewport = element;
					oncanvas?.(canvas);
				}}
				onGroupEdit={openGroupEditor}
				onGroupToggle={toggleGroup}
				onGroupDissolve={(groupId: string) => {
					void dissolveGroup(groupId);
				}}
				onJunctionEdit={openJunctionEditor}
				onJunctionInsert={(relationIds: readonly string[]) => {
					void insertJunction(relationIds);
				}}
				onCreateChild={(target: EntityRef) => {
					openDraft({ target });
				}}
				onCreateSibling={(sibling: EntityRef) => {
					openDraft({ sibling });
				}}
				onDelete={deleteSelection}
				onCopyNodes={() => {
					void copyNodesToClipboard();
				}}
				onPasteAt={(destination: NodePasteDestination) => {
					void pasteNodesFromClipboard(destination);
				}}
				onGroup={groupAction}
				onManageNatures={manageNaturesAction}
				onExport={onexport}
				onExportImage={onexportimage}
				report={layoutReport}
			/>
		</CanvasGestures>
		{#if editingGroup}
			{@const editing = editingGroup}
			<GroupDialog
				mode={editing.mode}
				draft={editing.draft}
				{lanes}
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
		{#if lanesDialog && model}
			<LanesDialog
				document={model}
				{busy}
				onsubmit={(command: SharedDocumentCommand) => {
					void saveLanes(command);
				}}
				onclose={() => {
					lanesDialog = false;
				}}
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
				oncreate={(family: string) => {
					editingNature = newNatureEditing(crypto.randomUUID(), family);
				}}
				onchange={(patch: Partial<NatureFields>) => {
					if (editingNature !== undefined)
						editingNature = { ...editingNature, draft: { ...editingNature.draft, ...patch } };
				}}
				onsave={saveNature}
				ondelete={(replacementId: string | undefined) => {
					void deleteNature(replacementId);
				}}
				onimport={(family: NatureFamily) => {
					void importNatures(family);
				}}
				onclose={closeNatures}
			/>
		{/if}
		{#if error}<p role="alert" class="ui-notice error absolute top-16 left-4 z-40 print:hidden">
				{error}
			</p>{/if}
		<CanvasViewportControls
			{session}
			viewportElement={canvasViewport}
			onreport={openLayoutReport}
		/>
		<CanvasActions
			enabled={interactive}
			{natures}
			nature={typing?.nature(natures)}
			oncreate={() => {
				openDraft({ near: session.relativeNodeCreationTarget });
			}}
			onnature={(natureId: string) => {
				if (typing !== undefined) typing.natureId = natureId;
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

	{#if layout}
		<div class="absolute top-7 left-1/2 z-20 -translate-x-1/2 print:hidden">
			<LayoutChip
				{layout}
				{lanes}
				disabled={!interactive}
				onchange={changeLayout}
				onlanes={openLanes}
			/>
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
