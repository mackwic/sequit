<script lang="ts">
	import 'quill/dist/quill.snow.css';

	import type Quill from 'quill';
	import { onMount } from 'svelte';
	import * as Y from 'yjs';

	import type { CollaborativeDocumentSession } from '../../../../../lib/infrastructure/collaboration/collaborative-document-session-types';
	import type { SharedTarget } from '../../../../../lib/infrastructure/document/shared-document-command';
	import { bindQuillMarkdown, type QuillMarkdownEditor } from '../../../document/quill-editor';
	import { getCollaborationAwareness } from './collaboration-awareness.svelte';
	import QuillPresence from './QuillPresence.svelte';

	let {
		client,
		target,
		field,
		label,
	}: {
		client: CollaborativeDocumentSession;
		target: SharedTarget;
		field: string;
		label: string;
	} = $props();
	const awareness = getCollaborationAwareness();
	const owner = Symbol('text editor');
	const text = $derived(client.text(target, field));
	let host: HTMLDivElement;
	let editor = $state<QuillMarkdownEditor>();
	let failure = $state('');

	onMount(() => {
		let disposed = false;
		let cleanup: (() => void) | undefined;
		async function initialize(): Promise<void> {
			const { default: Editor } = await import('quill');
			if (disposed || text === undefined) return;
			const quill = new Editor(host, {
				theme: 'snow',
				formats: [
					'bold',
					'italic',
					'strike',
					'code',
					'header',
					'list',
					'indent',
					'blockquote',
					'code-block',
					'link',
					'image',
				],
				modules: {
					toolbar: [
						[{ header: [1, 2, 3, false] }],
						['bold', 'italic', 'strike', 'code'],
						[{ list: 'ordered' }, { list: 'bullet' }],
						['blockquote', 'code-block', 'link'],
						['clean'],
					],
					history: { userOnly: true },
				},
			});
			quill.root.setAttribute('aria-label', label);
			quill.root.setAttribute('role', 'textbox');
			quill.root.setAttribute('aria-multiline', 'true');
			const binding = bindQuillMarkdown(quill, {
				text,
				edit: (markdown) => {
					client.updateText(target, field, markdown);
				},
				merge: (update) => {
					client.applyLocalTextUpdate(update);
				},
			});
			editor = binding.editor;
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
			cleanup = (): void => {
				binding.destroy();
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

<div class="shared-text-field">
	<span class="field-label">{label}</span>
	<div class="editor-wrapper">
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
</style>
