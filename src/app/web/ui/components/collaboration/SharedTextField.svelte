<script lang="ts">
	import 'quill/dist/quill.snow.css';

	import type Quill from 'quill';
	import { onMount } from 'svelte';
	import * as Y from 'yjs';

	import type { CollaborativeDocumentSession } from '../../../../../lib/infrastructure/collaboration/collaborative-document-session-types';
	import type { SharedTarget } from '../../../../../lib/infrastructure/document/shared-document-command';
	import { bindQuillMarkdown, type QuillMarkdownEditor } from '../../../document/quill-editor';
	import { quillEditorOptions, QuillEditorProfile } from '../../../document/quill-editor-config';
	import { getCollaborationAwareness } from './collaboration-awareness.svelte';
	import QuillPresence from './QuillPresence.svelte';

	let {
		client,
		target,
		field,
		label,
		connected,
		autofocus = false,
	}: {
		client: CollaborativeDocumentSession;
		target: SharedTarget;
		field: string;
		label: string;
		connected: boolean;
		autofocus?: boolean;
	} = $props();
	const awareness = getCollaborationAwareness();
	const owner = Symbol('text editor');
	const text = $derived(client.text(target, field));
	let host: HTMLDivElement;
	let editor = $state<QuillMarkdownEditor>();
	let quillInstance = $state.raw<Quill>();
	$effect(() => {
		quillInstance?.enable(connected);
	});
	let failure = $state('');
	let sourceMode = $state(false);
	const profile = $derived.by(() => {
		if (field === 'markdown') return QuillEditorProfile.Body;
		if (field === 'description') return QuillEditorProfile.Description;
		return QuillEditorProfile.Plain;
	});

	onMount(() => {
		let disposed = false;
		let cleanup: (() => void) | undefined;
		async function initialize(): Promise<void> {
			const { default: Editor } = await import('quill');
			if (disposed || text === undefined) return;
			const quill = new Editor(host, quillEditorOptions(profile));
			quill.root.setAttribute('aria-label', label);
			quill.root.setAttribute('role', 'textbox');
			quill.root.setAttribute('aria-multiline', 'true');
			const binding = bindQuillMarkdown(
				quill,
				{
					text,
					edit: (markdown) => {
						client.updateText(target, field, markdown);
					},
					merge: (update) => {
						client.applyLocalTextUpdate(target, field, update);
					},
				},
				profile,
			);
			editor = binding.editor;
			const updateMode = (): void => {
				sourceMode = binding.editor.sourceMode;
			};
			updateMode();
			binding.editor.addEventListener('modechange', updateMode);
			const protectSource = (event: KeyboardEvent): void => {
				if (!binding.editor.sourceMode || (!event.ctrlKey && !event.metaKey)) return;
				if (!['b', 'i', 'u'].includes(event.key.toLowerCase())) return;
				event.preventDefault();
				event.stopImmediatePropagation();
			};
			quill.root.addEventListener('keydown', protectSource, true);
			const publish = (): void => {
				if (disposed) return;
				if (!quill.hasFocus()) {
					awareness.textSelection(owner, null);
					return;
				}
				awareness.textSelection(owner, {
					target,
					field,
					anchor: Y.encodeRelativePosition(
						Y.createRelativePositionFromTypeIndex(text, binding.editor.selectionStart),
					),
					head: Y.encodeRelativePosition(
						Y.createRelativePositionFromTypeIndex(text, binding.editor.selectionEnd),
					),
				});
			};
			const changed = (_name: string, ...args: unknown[]): void => {
				if (args.at(-1) !== 'silent') queueMicrotask(publish);
			};
			quill.on('editor-change', changed);
			const clear = (): void => {
				awareness.textSelection(owner, null);
			};
			quill.root.addEventListener('blur', clear);
			window.addEventListener('blur', clear);
			labelToolbar(quill);
			quill.history.clear();
			quill.enable(connected);
			quillInstance = quill;
			if (autofocus && connected) quill.focus();
			cleanup = (): void => {
				quillInstance = undefined;
				binding.destroy();
				binding.editor.removeEventListener('modechange', updateMode);
				quill.root.removeEventListener('keydown', protectSource, true);
				quill.off('editor-change', changed);
				quill.root.removeEventListener('blur', clear);
				window.removeEventListener('blur', clear);
				clear();
			};
		}
		void initialize().catch((error: unknown) => {
			failure = String(error);
		});
		return () => {
			disposed = true;
			cleanup?.();
		};
	});

	function labelToolbar(quill: Quill): void {
		const labels: Record<string, string> = {
			bold: 'Gras',
			italic: 'Italique',
			underline: 'Souligné',
			strike: 'Barré',
			code: 'Code',
			blockquote: 'Citation',
			'code-block': 'Bloc de code',
			link: 'Lien',
			clean: 'Effacer la mise en forme',
			list: 'Liste',
		};
		for (const [format, title] of Object.entries(labels)) {
			for (const button of quill.container.parentElement?.querySelectorAll(`button.ql-${format}`) ??
				[])
				button.setAttribute('aria-label', title);
		}
	}
</script>

<div class="shared-text-field" data-text-field={field}>
	<span class="field-label">{label}</span>
	{#if sourceMode && profile !== QuillEditorProfile.Plain}
		<p class="source-notice" role="status">
			Ce contenu s’édite en texte source pour conserver toutes ses mises en forme.
		</p>
	{:else if editor && profile === QuillEditorProfile.Description}
		<button type="button" disabled={!connected} onclick={() => editor?.showSource()}
			>Texte source</button
		>
	{/if}
	<div
		class="editor-wrapper"
		class:source-mode={sourceMode && profile !== QuillEditorProfile.Plain}
	>
		<div bind:this={host}></div>
		{#if editor && text}<QuillPresence {editor} {text} />{/if}
	</div>
	{#if failure}<p role="alert">Impossible d’ouvrir l’éditeur : {failure}</p>{/if}
</div>

<style>
	.field-label {
		display: block;
		font-size: 13px;
		font-weight: 600;
		margin-bottom: 8px;
	}
	.editor-wrapper {
		position: relative;
		background: white;
		color: #292524;
		border-radius: 8px;
	}
	.editor-wrapper :global(.ql-editor) {
		min-height: 150px;
		max-height: 42vh;
		overflow-y: auto;
		font-size: 16px;
		line-height: 1.6;
	}
	.editor-wrapper :global(.ql-toolbar) {
		border-radius: 8px 8px 0 0;
	}
	.editor-wrapper :global(.ql-container) {
		border-radius: 0 0 8px 8px;
	}
	.source-mode :global(.ql-toolbar) {
		display: none;
	}
	.source-mode :global(.ql-editor) {
		font-family: monospace;
	}
	.source-notice {
		font-size: 12px;
		color: #57534e;
		margin: 0 0 8px;
	}
</style>
