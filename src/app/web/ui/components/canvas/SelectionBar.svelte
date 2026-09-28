<script lang="ts">
	import type { VirtualElement } from '@floating-ui/dom';

	import { entityKey, EntityKind } from '../../canvas/canvas-entity';
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
			getBoundingClientRect() {
				const bounds = [...viewportElement.querySelectorAll('[data-canvas-entity-key]')]
					.filter((element) => selected.has(element.getAttribute('data-canvas-entity-key') ?? ''))
					.map((element) => element.getBoundingClientRect());
				if (bounds.length === 0) return new DOMRect();
				const left = Math.min(...bounds.map((box) => box.left));
				const top = Math.min(...bounds.map((box) => box.top));
				const right = Math.max(...bounds.map((box) => box.right));
				const bottom = Math.max(...bounds.map((box) => box.bottom));
				return new DOMRect(left, top, right - left, bottom - top);
			},
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
	<FloatingActions {anchor} label="Selection actions" bind:element={floating}>
		{#if groupable}
			<button
				class="flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold text-stone-800 hover:bg-stone-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-950 disabled:cursor-not-allowed disabled:opacity-50"
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
				class="flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold text-stone-800 hover:bg-stone-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-950"
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
