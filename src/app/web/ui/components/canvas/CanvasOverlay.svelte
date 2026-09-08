<script lang="ts">
	import type { Snippet } from 'svelte';

	import { entityKey, EntityKind } from '../../canvas/canvas-entity';
	import type { CanvasModel } from '../../canvas/canvas-model';
	import type { CanvasSession, EditingCanvasActivity } from '../../session/canvas-session.svelte';
	import ContextualBar from './ContextualBar.svelte';
	import NodeMarkdownEditor from './NodeMarkdownEditor.svelte';

	let {
		canvas,
		viewportElement,
		session,
		editor,
		hideToolbar = false,
	}: {
		canvas: CanvasModel | undefined;
		viewportElement: HTMLDivElement | undefined;
		session: CanvasSession;
		hideToolbar?: boolean;
		editor?: Snippet<[EditingCanvasActivity, HTMLDivElement | undefined]> | undefined;
	} = $props();
	let contextualNode = $derived.by(() => {
		const key = session.contextualNodeKey;
		if (key === undefined || canvas === undefined || session.awaitingAcceptedLayout)
			return undefined;
		return canvas.nodes.find((node) => entityKey(EntityKind.Node, node.id) === key);
	});
</script>

<div class="pointer-events-none absolute inset-0 z-30 overflow-hidden" data-canvas-overlay>
	{#if contextualNode && viewportElement && !hideToolbar}
		<ContextualBar node={contextualNode} {viewportElement} {session} />
	{/if}
	{#if session.editing}
		{#if editor}
			{@render editor(session.editing, viewportElement)}
		{:else}
			<NodeMarkdownEditor editing={session.editing} {session} />
		{/if}
	{/if}
</div>
