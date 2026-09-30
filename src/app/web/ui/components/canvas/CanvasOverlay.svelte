<script lang="ts">
	import type { Snippet } from 'svelte';

	import { GroupState, type LogicNature } from '../../../../../lib/core/document/logic-document';
	import { EntityKind, type EntityRef } from '../../canvas/canvas-entity';
	import type { CanvasModel } from '../../canvas/canvas-model';
	import type { CanvasSession, EditingCanvasActivity } from '../../session/canvas-session.svelte';
	import ContextualBar from './ContextualBar.svelte';
	import NodeEditor from './NodeEditor.svelte';
	import SelectionBar from './SelectionBar.svelte';

	let {
		canvas,
		viewportElement,
		session,
		natures,
		editor,
		awareness,
		hideToolbar = false,
		onGroup,
		onGroupEdit,
		onGroupToggle,
		onGroupDissolve,
		onDelete,
	}: {
		canvas: CanvasModel | undefined;
		viewportElement: HTMLDivElement | undefined;
		session: CanvasSession;
		natures: readonly LogicNature[];
		hideToolbar?: boolean;
		onGroup?: (() => void) | undefined;
		onGroupEdit?: ((groupId: string) => void) | undefined;
		onGroupToggle?: ((groupId: string) => void) | undefined;
		onGroupDissolve?: ((groupId: string) => void) | undefined;
		onDelete?: (() => void) | undefined;
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
	function groupActions(entity: EntityRef): ContextualActions {
		const [edit, dissolve] = [onGroupEdit, onGroupDissolve];
		let actions: ContextualActions = { entity, ...foldAction(entity.id) };
		if (edit)
			actions = {
				...actions,
				edit: {
					label: `Éditer le groupe ${entity.id}`,
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
					label: `Éditer le nœud ${node.id}`,
					run: () => session.beginNodeEdit(node),
				},
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
			return { entity, ...foldAction(junction.groupId) };
		}
		if (!canvas.relations.some(({ id }) => id === entity.id)) return undefined;
		return { entity };
	});
</script>

<div class="pointer-events-none absolute inset-0 z-30 overflow-hidden" data-canvas-overlay>
	{#if awareness && canvas && viewportElement}{@render awareness(canvas, viewportElement)}{/if}
	{#if contextual && viewportElement && !hideToolbar}
		<ContextualBar
			entity={contextual.entity}
			edit={contextual.edit}
			fold={contextual.fold}
			dissolve={contextual.dissolve}
			{viewportElement}
			{onDelete}
		/>
	{/if}
	{#if viewportElement && !hideToolbar}
		<SelectionBar {viewportElement} {session} {onGroup} {onDelete} />
	{/if}
	{#if session.editing}
		{#if editor}
			{@render editor(session.editing, viewportElement)}
		{:else}
			<NodeEditor editing={session.editing} {session} {natures} />
		{/if}
	{/if}
</div>
