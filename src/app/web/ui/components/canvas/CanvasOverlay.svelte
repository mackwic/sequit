<script lang="ts">
	import type { Snippet } from 'svelte';

	import {
		GroupState,
		type LayoutLane,
		type LogicNature,
	} from '../../../../../lib/core/document/logic-document';
	import { m } from '../../../i18n/paraglide/messages';
	import { entityKey, EntityKind, type EntityRef } from '../../canvas/canvas-entity';
	import { canvasEntityElement } from '../../canvas/canvas-entity-dom';
	import type { CanvasModel } from '../../canvas/canvas-model';
	import { hostsJunction } from '../../canvas/junction-insertion';
	import { handleSides } from '../../canvas/node-handles';
	import {
		CanvasEditPresentation,
		type CanvasSession,
		type EditingCanvasActivity,
	} from '../../session/canvas-session.svelte';
	import ContextualBar from './ContextualBar.svelte';
	import type { NodeDraftControls } from './node-typing.svelte';
	import NodeEditor from './NodeEditor.svelte';
	import NodeHandles from './NodeHandles.svelte';
	import SelectionBar from './SelectionBar.svelte';
	import TypingBar from './TypingBar.svelte';

	let {
		canvas,
		viewportElement,
		session,
		natures,
		lanes = [],
		draft,
		editor,
		awareness,
		hideToolbar = false,
		onGroup,
		onGroupEdit,
		onGroupToggle,
		onGroupDissolve,
		onJunctionEdit,
		onJunctionInsert,
		onCreateChild,
		onCreateSibling,
		onDelete,
		onCopyNodes,
		onPasteInGroup,
	}: {
		canvas: CanvasModel | undefined;
		viewportElement: HTMLDivElement | undefined;
		session: CanvasSession;
		natures: readonly LogicNature[];
		/** Root lanes offered by the box dialog for a top-level box. */
		lanes?: readonly LayoutLane[];
		hideToolbar?: boolean;
		/** The box typed in place, new or existing: its bar takes the place of the contextual one. */
		draft?: NodeDraftControls | undefined;
		onGroup?: (() => void) | undefined;
		onGroupEdit?: ((groupId: string) => void) | undefined;
		onGroupToggle?: ((groupId: string) => void) | undefined;
		onGroupDissolve?: ((groupId: string) => void) | undefined;
		onJunctionEdit?: ((junctionId: string) => void) | undefined;
		/** Converges relations on a new junction: one from its bar, several from the selection bar. */
		onJunctionInsert?: ((relationIds: readonly string[]) => void) | undefined;
		/** Starts typing a child of the selected node or junction. */
		onCreateChild?: ((target: EntityRef) => void) | undefined;
		/** Starts typing a sibling of the selected node: same parents, group and lane. */
		onCreateSibling?: ((target: EntityRef) => void) | undefined;
		onDelete?: (() => void) | undefined;
		onCopyNodes?: (() => void) | undefined;
		onPasteInGroup?: ((groupId: string) => void) | undefined;
		editor?: Snippet<[EditingCanvasActivity, HTMLDivElement | undefined]> | undefined;
		awareness?: Snippet<[CanvasModel, HTMLDivElement]> | undefined;
	} = $props();
	interface FoldAction {
		/** The group that `[` and `]` act on: the entity itself or its container. */
		readonly groupId: string;
		readonly closed: boolean;
		readonly run: () => void;
	}
	interface ContextualActions {
		readonly entity: EntityRef;
		readonly edit?: { readonly label: string; readonly run: () => void };
		readonly fold?: FoldAction;
		readonly dissolve?: () => void;
		/** Inserts a junction on the selected relation. */
		readonly split?: () => void;
		/** Creates a child of the selected node or junction. */
		readonly child?: () => void;
		/** Creates a sibling of the selected node. */
		readonly sibling?: () => void;
		readonly copy?: () => void;
		readonly paste?: () => void;
	}
	function foldAction(groupId: string | undefined): { fold: FoldAction } | Record<string, never> {
		const toggle = onGroupToggle;
		if (toggle === undefined || groupId === undefined || canvas === undefined) return {};
		const group = canvas.groups.find(({ id }) => id === groupId);
		if (group === undefined) return {};
		return {
			fold: {
				groupId,
				closed: group.state === GroupState.Closed,
				run: () => {
					toggle(groupId);
				},
			},
		};
	}
	function childAction(entity: EntityRef): { child: () => void } | Record<string, never> {
		const create = onCreateChild;
		if (create === undefined) return {};
		return {
			child: () => {
				create(entity);
			},
		};
	}
	function siblingAction(entity: EntityRef): { sibling: () => void } | Record<string, never> {
		const create = onCreateSibling;
		if (create === undefined) return {};
		return {
			sibling: () => {
				create(entity);
			},
		};
	}
	function groupActions(entity: EntityRef): ContextualActions {
		const [edit, dissolve] = [onGroupEdit, onGroupDissolve];
		let actions: ContextualActions = { entity, ...foldAction(entity.id) };
		if (onPasteInGroup)
			actions = {
				...actions,
				paste: () => {
					onPasteInGroup(entity.id);
				},
			};
		if (edit)
			actions = {
				...actions,
				edit: {
					label: m.canvas_edit_group({ id: entity.id }),
					run: () => {
						edit(entity.id);
					},
				},
			};
		if (dissolve)
			actions = {
				...actions,
				dissolve: () => {
					dissolve(entity.id);
				},
			};
		return actions;
	}
	/** A box typed in place is drawn on the canvas, not in the dialog. */
	let dialogEditing = $derived.by((): EditingCanvasActivity | undefined => {
		const editing = session.editing;
		if (editing?.presentation !== CanvasEditPresentation.Dialog) return undefined;
		return editing;
	});
	let contextual = $derived.by((): ContextualActions | undefined => {
		const entity = session.contextualEntity;
		if (entity === undefined || canvas === undefined || session.awaitingAcceptedLayout)
			return undefined;
		if (entity.kind === EntityKind.Node) {
			const node = canvas.nodes.find(({ id }) => id === entity.id);
			if (node === undefined) return undefined;
			return {
				entity,
				edit: {
					label: m.canvas_edit_node({ id: node.id }),
					run: () => session.beginNodeEdit(node),
				},
				...childAction(entity),
				...siblingAction(entity),
				...(onCopyNodes && { copy: onCopyNodes }),
				...foldAction(node.navigation?.groupId),
			};
		}
		if (entity.kind === EntityKind.Group) {
			if (!canvas.groups.some(({ id }) => id === entity.id)) return undefined;
			return groupActions(entity);
		}
		if (entity.kind === EntityKind.Junction) {
			const junction = canvas.junctions.find(({ id }) => id === entity.id);
			if (junction === undefined) return undefined;
			const edit = onJunctionEdit;
			let actions: ContextualActions = {
				entity,
				...childAction(entity),
				...foldAction(junction.groupId),
			};
			if (edit)
				actions = {
					...actions,
					edit: {
						label: m.canvas_edit_junction({ id: entity.id }),
						run: () => {
							edit(entity.id);
						},
					},
				};
			return actions;
		}
		const relation = canvas.relations.find(({ id }) => id === entity.id);
		if (relation === undefined) return undefined;
		const insert = onJunctionInsert;
		if (insert === undefined || !hostsJunction(relation)) return { entity };
		return {
			entity,
			split: () => {
				insert([entity.id]);
			},
		};
	});
	/** Several relations, all plain, converge on one junction from the selection bar. */
	let selectionJunction = $derived.by((): (() => void) | undefined => {
		const insert = onJunctionInsert;
		const current = canvas;
		const selected = [...session.selection.values()];
		if (insert === undefined || current === undefined || selected.length < 2) return undefined;
		const plain = selected.every((entity) => {
			const relation = current.relations.find(({ id }) => id === entity.id);
			return (
				entity.kind === EntityKind.Relation && relation !== undefined && hostsJunction(relation)
			);
		});
		if (!plain) return undefined;
		const relationIds = selected.map(({ id }) => id);
		return () => {
			insert(relationIds);
		};
	});
	/** The bar waits for the box: a new one is only drawn once laid out, and a parked one has none. */
	let typed = $derived.by((): NodeDraftControls | undefined => {
		const current = draft;
		if (current === undefined || canvas === undefined || current.parked) return undefined;
		if (!canvas.nodes.some(({ id }) => id === current.id)) return undefined;
		return current;
	});
	/** The « + » handles of the selected box: a child away from the goal, a sibling beside it. */
	let handles = $derived.by(() => {
		const actions = contextual;
		const direction = canvas?.direction;
		if (actions?.entity.kind !== EntityKind.Node || direction === undefined) return undefined;
		if (viewportElement === undefined || hideToolbar) return undefined;
		const { child, sibling } = actions;
		if (child === undefined || sibling === undefined) return undefined;
		const anchor = canvasEntityElement(
			viewportElement,
			entityKey(EntityKind.Node, actions.entity.id),
		);
		if (!(anchor instanceof HTMLElement)) return undefined;
		return { anchor, nodeId: actions.entity.id, sides: handleSides(direction), child, sibling };
	});
</script>

<div
	class="pointer-events-none absolute inset-0 z-30 overflow-hidden print:hidden"
	data-canvas-overlay
>
	{#if awareness && canvas && viewportElement}{@render awareness(canvas, viewportElement)}{/if}
	{#if contextual && viewportElement && !hideToolbar}
		<ContextualBar
			entity={contextual.entity}
			edit={contextual.edit}
			fold={contextual.fold}
			dissolve={contextual.dissolve}
			split={contextual.split}
			child={contextual.child}
			sibling={contextual.sibling}
			copy={contextual.copy}
			paste={contextual.paste}
			{viewportElement}
			{onDelete}
		/>
	{/if}
	{#if handles}
		<NodeHandles {...handles} />
	{/if}
	{#if viewportElement && !hideToolbar}
		<SelectionBar
			{viewportElement}
			{session}
			{onGroup}
			onJunction={selectionJunction}
			{onDelete}
			{onCopyNodes}
		/>
	{/if}
	{#if typed && viewportElement}
		{#key typed.id}<TypingBar draft={typed} {viewportElement} />{/key}
	{/if}
	{#if dialogEditing}
		{#if editor}
			{@render editor(dialogEditing, viewportElement)}
		{:else}
			<NodeEditor editing={dialogEditing} {session} {natures} {lanes} />
		{/if}
	{/if}
</div>
