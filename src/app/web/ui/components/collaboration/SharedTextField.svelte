<script lang="ts">
	import 'quill/dist/quill.snow.css';
	import '../../styles/text-field.css';

	import type Quill from 'quill';
	import { onMount } from 'svelte';

	import type { CollaborativeDocumentSession } from '../../../../../lib/infrastructure/collaboration/collaborative-document-session-types';
	import type { SharedTarget } from '../../../../../lib/infrastructure/document/shared-document-command';
	import type { QuillMarkdownEditor } from '../../../document/quill-editor';
	import { QuillEditorProfile } from '../../../document/quill-editor-config';
	import { m } from '../../../i18n/paraglide/messages';
	import { getCollaborationAwareness } from './collaboration-awareness.svelte';
	import QuillPresence from './QuillPresence.svelte';
	import { mountSharedText } from './shared-text-editor';

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
			if (text === undefined) return;
			const shared = await mountSharedText(host, {
				client,
				awareness,
				target,
				field,
				text,
				profile,
				label,
				placeholder,
				enabled: connected,
			});
			if (disposed) {
				shared.destroy();
				return;
			}
			const { quill } = shared;
			editor = shared.editor;
			const updateMode = (): void => {
				sourceMode = shared.editor.sourceMode;
			};
			updateMode();
			shared.editor.addEventListener('modechange', updateMode);
			quillInstance = quill;
			if (autofocus && connected) quill.focus();
			cleanup = (): void => {
				quillInstance = undefined;
				shared.editor.removeEventListener('modechange', updateMode);
				shared.destroy();
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
				{m.collaboration_shared_text_source_mode_note()}
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
			{m.collaboration_shared_text_editor_open_failed({ failure })}
		</p>{/if}
</div>
