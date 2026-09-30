<script lang="ts">
	import 'quill/dist/quill.snow.css';
	import '../../styles/text-field.css';

	import { onMount } from 'svelte';

	import { QuillMarkdownEditor } from '../../../document/quill-editor';
	import { quillEditorOptions, QuillEditorProfile } from '../../../document/quill-editor-config';
	import { describeQuillField } from '../../../document/quill-field';

	let {
		value,
		onchange,
		profile,
		label,
		title = label,
		field,
		placeholder,
		disabled = false,
		autofocus = false,
	}: {
		/** Markdown, owned by the caller: the field reports every edit and follows outside changes. */
		value: string;
		onchange: (markdown: string) => void;
		profile: QuillEditorProfile;
		/** Accessible name of the text box. */
		label: string;
		/** Visible heading; the accessible name by default. */
		title?: string;
		field: string;
		placeholder?: string | undefined;
		disabled?: boolean;
		autofocus?: boolean;
	} = $props();
	let host: HTMLDivElement;
	let editor = $state<QuillMarkdownEditor>();
	let failure = $state('');
	let sourceMode = $state(false);
	$effect(() => {
		editor?.quill.enable(!disabled);
	});
	$effect(() => {
		if (editor !== undefined && editor.value !== value) editor.value = value;
	});

	onMount(() => {
		let disposed = false;
		let cleanup: (() => void) | undefined;
		async function initialize(): Promise<void> {
			const { default: Editor } = await import('quill');
			if (disposed) return;
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
			const markdown = new QuillMarkdownEditor(quill, profile);
			const updateMode = (): void => {
				sourceMode = markdown.sourceMode;
			};
			markdown.addEventListener('modechange', updateMode);
			markdown.value = value;
			updateMode();
			quill.history.clear();
			const changed = (_delta: unknown, _previous: unknown, source: string): void => {
				if (source === 'user') onchange(markdown.value);
			};
			quill.on('text-change', changed);
			quill.enable(!disabled);
			editor = markdown;
			if (autofocus && !disabled) quill.focus();
			cleanup = (): void => {
				editor = undefined;
				quill.off('text-change', changed);
				markdown.removeEventListener('modechange', updateMode);
				undescribe();
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
		class:disabled
	>
		<div bind:this={host}></div>
	</div>
	{#if failure}<p class="ui-notice error" role="alert">
			Impossible d’ouvrir l’éditeur : {failure}
		</p>{/if}
</div>
