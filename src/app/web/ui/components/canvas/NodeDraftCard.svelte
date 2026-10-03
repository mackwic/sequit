<script lang="ts">
	import 'quill/dist/quill.snow.css';

	import type Quill from 'quill';
	import { onMount, untrack } from 'svelte';

	import { m } from '../../../i18n/paraglide/messages';
	import { scrollCanvasBy } from '../../canvas/canvas-entity-dom';
	import type { RenderedCanvasNode } from '../../canvas/canvas-model';
	import { revealScrollDelta } from '../../canvas/canvas-viewport';
	import LogicNode from './LogicNode.svelte';
	import type { NodeDraftControls } from './node-typing.svelte';

	let {
		node,
		draft,
	}: {
		/** Where the layout puts the box once created. */
		node: RenderedCanvasNode;
		/** The box this card was opened for; the card never acts on a later one. */
		draft: NodeDraftControls;
	} = $props();
	// The prop follows the box being typed, which changes as soon as this one is done with.
	const own = untrack(() => draft);
	/** Room kept around the box when the viewport scrolls to it: its actions sit above it. */
	const REVEAL_MARGIN = 72;
	/** Gap between the box and why it was refused, in canvas pixels. */
	const NOTICE_GAP = 6;
	let scope = $state<HTMLElement>();
	let card = $state<HTMLElement>();
	let host = $state<HTMLElement>();
	let failure = $state('');
	let editor: Quill | undefined;

	/** The canvas neither selects, drags nor creates from inside the box being typed. */
	function contain(event: Event): void {
		event.stopPropagation();
	}
	/** As on any box, the header opens the properties: the typed text is kept first. */
	function doubleClick(event: MouseEvent): void {
		event.stopPropagation();
		if (event.target instanceof Element && event.target.closest('[data-node-header]') !== null)
			own.edit();
	}
	/** A parked box is typed again from within, by a click or the keyboard. */
	function resume(): void {
		if (own.parked) own.resume();
	}
	// Parked, the box keeps no focus: keys no longer reach a box that no bar shows as typed.
	$effect(() => {
		if (own.parked && editor?.hasFocus() === true) editor.blur();
	});
	function reveal(): void {
		const viewport = scope?.closest('[data-canvas-viewport]');
		if (!viewport || !card) return;
		scrollCanvasBy(
			viewport,
			revealScrollDelta(
				viewport.getBoundingClientRect(),
				card.getBoundingClientRect(),
				REVEAL_MARGIN,
			),
		);
	}

	onMount(() => {
		let disposed = false;
		let destroy: (() => void) | undefined;
		const target = host;
		if (target === undefined) return;
		own
			.mount(target, own.textLabel)
			.then((text) => {
				if (disposed) {
					text.destroy();
					return;
				}
				destroy = text.destroy;
				const { quill } = text;
				editor = quill;
				// A silent selection focuses the text without the instant scroll of a plain focus.
				quill.setSelection(quill.getLength() - 1, 0, 'silent');
				reveal();
			})
			.catch((error: unknown) => {
				failure = String(error);
			});
		return () => {
			disposed = true;
			editor = undefined;
			destroy?.();
		};
	});
</script>

<!-- Only stops the canvas gestures; the editor takes the keys, its bar the box's own. -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="contents"
	bind:this={scope}
	onpointerdown={contain}
	onclick={contain}
	ondblclick={doubleClick}
	onfocusin={resume}
>
	<LogicNode {node} label={own.label} parked={own.parked} bind:element={card}>
		{#snippet body()}<span class="draft-editor" bind:this={host}></span>{/snippet}
	</LogicNode>
	{#if own.diagnostic !== undefined || failure !== ''}
		<div
			class="draft-notices"
			style:left={`${node.bounds.x}px`}
			style:top={`${node.bounds.y + node.bounds.height + NOTICE_GAP}px`}
			style:width={`${node.bounds.width}px`}
		>
			{#if own.diagnostic}<p class="ui-notice error" role="alert">{own.diagnostic}</p>{/if}
			{#if failure}<p class="ui-notice error" role="alert">
					{m.content_markdown_field_init_error({ failure })}
				</p>{/if}
		</div>
	{/if}
</div>

<style>
	.draft-editor {
		display: block;
	}
	/* The editor writes like the box reads, so that the typed text keeps its measured size. Quill
	   makes the host itself its container. */
	.draft-editor:global(.ql-container.ql-snow) {
		border: 0;
		font: inherit;
	}
	/* The box shows that it is being typed; the text needs no ring of its own. */
	.draft-editor :global(.ql-editor),
	.draft-editor :global(.ql-editor:focus-visible) {
		height: auto;
		overflow: visible;
		padding: 0;
		outline: none;
		caret-color: var(--ui-accent);
		line-height: inherit;
		white-space: pre-wrap;
	}
	.draft-editor :global(.ql-editor.ql-blank::before) {
		right: 0;
		left: 0;
		color: var(--ui-muted);
		font-style: normal;
	}
	.draft-notices {
		position: absolute;
		z-index: 25;
	}
	@media print {
		.draft-notices {
			display: none;
		}
	}
</style>
