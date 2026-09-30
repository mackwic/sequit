<script lang="ts">
	import type { VirtualElement } from '@floating-ui/dom';

	import { entityKey, EntityKind } from '../../canvas/canvas-entity';
	import { canvasSelectionBounds } from '../../canvas/canvas-entity-dom';
	import type { CanvasSession } from '../../session/canvas-session.svelte';
	import Icon from '../ui/Icon.svelte';
	import CanvasShortcut from './CanvasShortcut.svelte';
	import FloatingActions from './FloatingActions.svelte';

	let {
		viewportElement,
		session,
		onGroup,
		onDelete,
	}: {
		viewportElement: HTMLDivElement;
		session: CanvasSession;
		onGroup?: (() => void) | undefined;
		onDelete?: (() => void) | undefined;
	} = $props();
	let floating = $state<HTMLDivElement>();
	let selectedNodeIds = $derived(
		[...session.selection.values()]
			.filter(({ kind }) => kind === EntityKind.Node)
			.map(({ id }) => id),
	);
	let groupable = $derived(selectedNodeIds.length === session.selectionCount);
	let anchor = $derived.by((): VirtualElement | undefined => {
		if (session.selectionCount < 2 || (!groupable && onDelete === undefined)) return undefined;
		const selected = new Set<string>(
			[...session.selection.values()].map(({ kind, id }) => entityKey(kind, id)),
		);
		return {
			contextElement: viewportElement,
			getBoundingClientRect: () =>
				canvasSelectionBounds(viewportElement, selected) ?? new DOMRect(),
		};
	});
</script>

{#if anchor}
	<CanvasShortcut
		key="g"
		scopes={[viewportElement, floating]}
		enabled={groupable && onGroup !== undefined}
		onactivate={() => onGroup?.()}
	/>
	<FloatingActions
		{anchor}
		boundary={viewportElement}
		label="Actions de la sélection"
		bind:element={floating}
	>
		{#if groupable}
			<button
				class="ui-action quiet"
				type="button"
				disabled={onGroup === undefined}
				aria-label={`Grouper ${selectedNodeIds.length} nœuds`}
				aria-keyshortcuts="g"
				title="Grouper (G)"
				onclick={() => onGroup?.()}
			>
				<Icon name="phosphor:folder-plus" />
				<span><span class="underline decoration-1 underline-offset-2">G</span>rouper</span>
			</button>
		{/if}
		{#if onDelete}
			<button
				class="ui-action quiet"
				type="button"
				aria-label={`Supprimer ${session.selectionCount} éléments`}
				aria-keyshortcuts="Delete"
				title="Supprimer (Suppr)"
				onclick={onDelete}
			>
				<Icon name="phosphor:trash" />
				<span>Supprimer</span>
			</button>
		{/if}
	</FloatingActions>
{/if}
