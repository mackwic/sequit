<script lang="ts">
	import 'quill/dist/quill.snow.css';
	import '../../styles/text-field.css';

	import { onMount } from 'svelte';

	import { mountQuillMarkdown, type QuillMarkdownEditor } from '../../../document/quill-editor';
	import { QuillEditorProfile } from '../../../document/quill-editor-config';
	import { m } from '../../../i18n/paraglide/messages';

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
			const field = await mountQuillMarkdown(host, {
				profile,
				label,
				placeholder,
				value,
				onchange: (markdown: string) => {
					onchange(markdown);
				},
			});
			if (disposed) {
				field.destroy();
				return;
			}
			const markdown = field.editor;
			const updateMode = (): void => {
				sourceMode = markdown.sourceMode;
			};
			markdown.addEventListener('modechange', updateMode);
			updateMode();
			markdown.quill.enable(!disabled);
			editor = markdown;
			if (autofocus && !disabled) markdown.quill.focus();
			cleanup = (): void => {
				editor = undefined;
				markdown.removeEventListener('modechange', updateMode);
				field.destroy();
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
			<p class="text-field-note" role="status">{m.content_markdown_field_source_mode_note()}</p>
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
			{m.content_markdown_field_init_error({ failure })}
		</p>{/if}
</div>
