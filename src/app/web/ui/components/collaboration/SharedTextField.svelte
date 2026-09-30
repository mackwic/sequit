<script lang="ts">
	import 'quill/dist/quill.snow.css';
	import '../../styles/text-field.css';

	import type Quill from 'quill';
	import { onMount } from 'svelte';
	import * as Y from 'yjs';

	import type { CollaborativeDocumentSession } from '../../../../../lib/infrastructure/collaboration/collaborative-document-session-types';
	import type { SharedTarget } from '../../../../../lib/infrastructure/document/shared-document-command';
	import { bindQuillMarkdown, type QuillMarkdownEditor } from '../../../document/quill-editor';
	import { quillEditorOptions, QuillEditorProfile } from '../../../document/quill-editor-config';
	import { describeQuillField } from '../../../document/quill-field';
	import { getCollaborationAwareness } from './collaboration-awareness.svelte';
	import QuillPresence from './QuillPresence.svelte';

	let {
		client,
		target,
		field,
		label,
		title = label,
		placeholder,
		connected,
		autofocus = false,
	}: {
		client: CollaborativeDocumentSession;
		target: SharedTarget;
		field: string;
		/** Accessible name of the text box. */
		label: string;
		/** Visible heading; the accessible name by default. */
		title?: string;
		placeholder?: string | undefined;
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
			const quill = new Editor(
				host,
				quillEditorOptions(profile, {
					placeholder,
					showSource: () => {
						editor?.showSource();
					},
				}),
			);
			const undescribe = describeQuillField(quill, label);
			const binding = bindQuillMarkdown(
				quill,
				{
					text,
					edit: (markdown) => {
						client.updateText(target, field, markdown, text);
					},
					merge: (update) => {
						client.applyLocalTextUpdate(target, field, update, text);
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
				undescribe();
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
</script>

<div class="text-field" data-text-field={field}>
	<div class="text-field-heading">
		<span class="text-field-title">{title}</span>
		{#if sourceMode && profile !== QuillEditorProfile.Plain}
			<p class="text-field-note" role="status">
				Édité en texte source pour conserver toutes ses mises en forme.
			</p>
		{/if}
	</div>
	<div
		class="text-field-editor"
		class:source-mode={sourceMode && profile !== QuillEditorProfile.Plain}
		class:disabled={!connected}
	>
		<div bind:this={host}></div>
		{#if editor && text}<QuillPresence {editor} {text} />{/if}
	</div>
	{#if failure}<p class="ui-notice error" role="alert">
			Impossible d’ouvrir l’éditeur : {failure}
		</p>{/if}
</div>
