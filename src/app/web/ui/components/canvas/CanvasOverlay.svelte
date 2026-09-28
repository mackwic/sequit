<script lang="ts">
	import type { Snippet } from 'svelte';

	import { EntityKind, type EntityRef } from '../../canvas/canvas-entity';
	import type { CanvasModel } from '../../canvas/canvas-model';
	import type { CanvasSession, EditingCanvasActivity } from '../../session/canvas-session.svelte';
	import ContextualBar from './ContextualBar.svelte';
	import NodeMarkdownEditor from './NodeMarkdownEditor.svelte';
	import SelectionBar from './SelectionBar.svelte';

	let {
		canvas,
		viewportElement,
		session,
		editor,
		awareness,
		hideToolbar = false,
		onGroup,
		onGroupEdit,
		onDelete,
	}: {
		canvas: CanvasModel | undefined;
		viewportElement: HTMLDivElement | undefined;
		session: CanvasSession;
		hideToolbar?: boolean;
		onGroup?: (() => void) | undefined;
		onGroupEdit?: ((groupId: string) => void) | undefined;
		onDelete?: (() => void) | undefined;
		editor?: Snippet<[EditingCanvasActivity, HTMLDivElement | undefined]> | undefined;
		awareness?: Snippet<[CanvasModel, HTMLDivElement]> | undefined;
	} = $props();
	let contextual = $derived.by(
		(): { entity: EntityRef; edit?: { label: string; run: () => void } } | undefined => {
			const entity = session.contextualEntity;
			if (entity === undefined || canvas === undefined || session.awaitingAcceptedLayout)
				return undefined;
			if (entity.kind === EntityKind.Node) {
				const node = canvas.nodes.find(({ id }) => id === entity.id);
				if (node === undefined) return undefined;
				return {
					entity,
					edit: {
						label: `Edit Markdown for node ${node.id}`,
						run: () => session.beginNodeMarkdownEdit(node),
					},
				};
			}
			const rendered: readonly { readonly id: string }[] = {
				[EntityKind.Group]: canvas.groups,
				[EntityKind.Junction]: canvas.junctions,
				[EntityKind.Relation]: canvas.relations,
			}[entity.kind];
			if (!rendered.some(({ id }) => id === entity.id)) return undefined;
			if (entity.kind === EntityKind.Group && onGroupEdit) {
				const edit = onGroupEdit;
				const run = (): void => {
					edit(entity.id);
				};
				return { entity, edit: { label: `Edit group ${entity.id}`, run } };
			}
			return { entity };
		},
	);
</script>

<div class="pointer-events-none absolute inset-0 z-30 overflow-hidden" data-canvas-overlay>
	{#if awareness && canvas && viewportElement}{@render awareness(canvas, viewportElement)}{/if}
	{#if contextual && viewportElement && !hideToolbar}
		<ContextualBar entity={contextual.entity} edit={contextual.edit} {viewportElement} {onDelete} />
	{/if}
	{#if viewportElement && !hideToolbar}
		<SelectionBar {viewportElement} {session} {onGroup} {onDelete} />
	{/if}
	{#if session.editing}
		{#if editor}
			{@render editor(session.editing, viewportElement)}
		{:else}
			<NodeMarkdownEditor editing={session.editing} {session} />
		{/if}
	{/if}
</div>
