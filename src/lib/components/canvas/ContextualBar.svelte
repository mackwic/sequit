<script lang="ts">
	import type { RenderedCanvasNode } from '$lib/canvas/canvas-model';
	import Icon from '$lib/components/ui/Icon.svelte';
	import type { CanvasSession } from '$lib/session/canvas-session.svelte';

	import CanvasShortcut from './CanvasShortcut.svelte';
	import FloatingActions from './FloatingActions.svelte';

	let {
		node,
		viewportElement,
		session,
	}: {
		node: RenderedCanvasNode;
		viewportElement: HTMLDivElement;
		session: CanvasSession;
	} = $props();
	let floating = $state<HTMLDivElement>();

	let anchor = $derived(
		[...viewportElement.querySelectorAll<HTMLElement>('[data-node-id]')].find(
			(element) => element.dataset['nodeId'] === node.id,
		),
	);
</script>

<CanvasShortcut
	key="e"
	scopes={[viewportElement, floating]}
	onactivate={() => {
		session.beginNodeMarkdownEdit(node);
	}}
/>
<FloatingActions {anchor} label="Node actions" bind:element={floating}>
	<button
		class="flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold text-stone-800 hover:bg-stone-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-950"
		type="button"
		aria-label={`Edit Markdown for node ${node.id}`}
		aria-keyshortcuts="e"
		title="Edit (E)"
		onclick={() => session.beginNodeMarkdownEdit(node)}
	>
		<Icon name="phosphor:pencil-simple" />
		<span><span class="underline decoration-1 underline-offset-2">E</span>dit</span>
	</button>
</FloatingActions>
