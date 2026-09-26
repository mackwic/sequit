<script lang="ts">
	import type * as Y from 'yjs';

	import type { QuillMarkdownEditor } from '../../../document/quill-editor';
	import { remoteTextRanges } from '../../../document/text-awareness';
	import { getCollaborationAwareness } from './collaboration-awareness.svelte';

	let { editor, text }: { editor: QuillMarkdownEditor; text: Y.Text } = $props();
	const awareness = getCollaborationAwareness();
	let overlay = $state<HTMLDivElement>();
	let revision = $state(0);
	$effect(() => {
		const observedText = text;
		const quill = editor.quill;
		const refresh = (): void => {
			revision += 1;
		};
		observedText.observe(refresh);
		quill.on('editor-change', refresh);
		quill.root.addEventListener('scroll', refresh);
		const observer = new ResizeObserver(refresh);
		observer.observe(quill.root);
		return () => {
			observedText.unobserve(refresh);
			quill.off('editor-change', refresh);
			quill.root.removeEventListener('scroll', refresh);
			observer.disconnect();
		};
	});
	const peers = $derived.by(() => {
		// Geometry must also be recomputed when text, wrapping or scrolling changes.
		const currentRevision = revision;
		if (!overlay) return { revision: currentRevision, items: [] };
		const origin = overlay.getBoundingClientRect();
		const container = editor.quill.container.getBoundingClientRect();
		const items = remoteTextRanges(text, awareness.participants).map((peer) => {
			const head = editor.toEditor(peer.head);
			const anchor = editor.toEditor(peer.anchor);
			const caret = editor.quill.getBounds(head);
			const rects: { left: number; top: number; width: number; height: number }[] = [];
			const [startLeaf, startOffset] = editor.quill.getLeaf(Math.min(anchor, head));
			const [endLeaf, endOffset] = editor.quill.getLeaf(Math.max(anchor, head));
			if (
				anchor !== head &&
				startLeaf?.domNode.nodeType === Node.TEXT_NODE &&
				endLeaf?.domNode.nodeType === Node.TEXT_NODE
			) {
				const range = document.createRange();
				range.setStart(startLeaf.domNode, startOffset);
				range.setEnd(endLeaf.domNode, endOffset);
				for (const rect of range.getClientRects())
					rects.push({
						left: rect.left - origin.left,
						top: rect.top - origin.top,
						width: rect.width,
						height: rect.height,
					});
			}
			let position;
			if (caret)
				position = {
					left: caret.left + container.left - origin.left,
					top: caret.top + container.top - origin.top,
					height: caret.height,
				};
			return { ...peer, rects, position };
		});
		return { revision: currentRevision, items };
	});
</script>

<div class="quill-presence" bind:this={overlay} aria-hidden="true">
	{#each peers.items as peer (peer.clientId)}
		{#each peer.rects as rect, index (index)}<span
				class="remote-text-selection"
				style:left={`${rect.left}px`}
				style:top={`${rect.top}px`}
				style:width={`${rect.width}px`}
				style:height={`${rect.height}px`}
				style:background={peer.color}
			></span>{/each}
		{#if peer.position}<span
				class="remote-text-cursor"
				data-participant={peer.name}
				style:left={`${peer.position.left}px`}
				style:top={`${peer.position.top}px`}
				style:height={`${peer.position.height}px`}
				style:--peer-color={peer.color}><span>{peer.name}</span></span
			>{/if}
	{/each}
</div>

<style>
	.quill-presence {
		position: absolute;
		inset: 0;
		pointer-events: none;
		overflow: hidden;
	}
	.remote-text-selection {
		position: absolute;
		opacity: 0.18;
	}
	.remote-text-cursor {
		position: absolute;
		border-left: 2px solid var(--peer-color);
	}
	.remote-text-cursor > span {
		position: absolute;
		bottom: 100%;
		left: -2px;
		padding: 1px 5px;
		border-radius: 3px 3px 3px 0;
		background: var(--peer-color);
		color: white;
		font: 11px/1.4 sans-serif;
		white-space: nowrap;
	}
</style>
