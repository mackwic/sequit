<script lang="ts">
	import type { VirtualElement } from '@floating-ui/dom';

	import { EntityKind } from '../../canvas/canvas-entity';
	import type { CanvasSession } from '../../session/canvas-session.svelte';
	import Icon from '../ui/Icon.svelte';
	import CanvasShortcut from './CanvasShortcut.svelte';
	import FloatingActions from './FloatingActions.svelte';

	let {
		viewportElement,
		session,
		onGroup,
	}: {
		viewportElement: HTMLDivElement;
		session: CanvasSession;
		onGroup?: (() => void) | undefined;
	} = $props();
	let floating = $state<HTMLDivElement>();
	let selectedNodeIds = $derived(
		[...session.selection.values()]
			.filter(({ kind }) => kind === EntityKind.Node)
			.map(({ id }) => id),
	);
	let anchor = $derived.by((): VirtualElement | undefined => {
		const ids = selectedNodeIds;
		if (ids.length < 2 || ids.length !== session.selectionCount) return undefined;
		return {
			contextElement: viewportElement,
			getBoundingClientRect() {
				const selected = new Set(ids);
				const bounds = [...viewportElement.querySelectorAll<HTMLElement>('[data-node-id]')]
					.filter((element) => selected.has(element.dataset['nodeId'] ?? ''))
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
		enabled={onGroup !== undefined}
		onactivate={() => onGroup?.()}
	/>
	<FloatingActions {anchor} label="Selection actions" bind:element={floating}>
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
	</FloatingActions>
{/if}
