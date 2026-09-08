<script lang="ts">
	import { tick } from 'svelte';

	import type { CanvasSession, EditingCanvasActivity } from '../../session/canvas-session.svelte';
	import NodeMarkdownForm from './NodeMarkdownForm.svelte';

	let { editing, session }: { editing: EditingCanvasActivity; session: CanvasSession } = $props();
	const editorId = $props.id();
	let dialog = $state<HTMLDialogElement>();
	let textarea = $state<HTMLTextAreaElement>();
	let opened = false;

	$effect(() => {
		const currentDialog = dialog;
		const currentTextarea = textarea;
		if (!currentDialog || !currentTextarea || opened) return;
		opened = true;
		currentDialog.showModal();
		void tick().then(() => {
			currentTextarea.focus();
		});
	});

	function cancel(event: Event) {
		event.preventDefault();
		session.cancel();
	}

	function cancelFromBackdrop(event: MouseEvent) {
		if (event.target === dialog) session.cancel();
	}

	function containFocus(event: KeyboardEvent) {
		if (event.key !== 'Tab' || !dialog) return;
		const controls = [
			...dialog.querySelectorAll<HTMLElement>('textarea:not(:disabled), button:not(:disabled)'),
		];
		const first = controls[0];
		const last = controls.at(-1);
		if (first === undefined || last === undefined) return;
		if (event.shiftKey && document.activeElement === first) {
			event.preventDefault();
			last.focus();
		} else if (!event.shiftKey && document.activeElement === last) {
			event.preventDefault();
			first.focus();
		}
	}
</script>

<dialog
	class="node-editor pointer-events-auto m-auto w-[min(48rem,calc(100vw-2rem))] max-w-none overflow-hidden rounded-2xl border border-stone-300 bg-white p-0 text-stone-950 shadow-2xl"
	data-node-markdown-editor={editing.nodeId}
	aria-modal="true"
	aria-labelledby={`node-markdown-title-${editorId}`}
	aria-describedby={`node-markdown-context-${editorId}`}
	bind:this={dialog}
	oncancel={cancel}
	onclick={cancelFromBackdrop}
	onkeydown={containFocus}
>
	<NodeMarkdownForm {editing} {session} bind:textarea>
		{#snippet header()}
			<header
				class="shrink-0 border-b border-stone-200 bg-stone-50 px-6 py-5 max-sm:px-4 max-sm:py-4"
			>
				<p class="m-0 text-xs font-bold tracking-[0.12em] text-stone-500 uppercase">Node content</p>
				<h2 class="mt-1 mb-0 text-xl font-semibold" id={`node-markdown-title-${editorId}`}>
					Edit Markdown
				</h2>
				<p class="mt-1 mb-0 text-sm text-stone-600" id={`node-markdown-context-${editorId}`}>
					Editing node <code class="rounded bg-stone-200 px-1.5 py-0.5 text-xs"
						>{editing.nodeId}</code
					>. Write Markdown, then save to update the graph.
				</p>
			</header>
		{/snippet}
	</NodeMarkdownForm>
</dialog>

<style>
	.node-editor::backdrop {
		background: rgb(28 25 23 / 0.58);
		backdrop-filter: blur(2px);
	}
</style>
