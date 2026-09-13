<script lang="ts">
	import type { CollaborativeDocumentSession } from '../../../../../lib/infrastructure/collaboration/collaborative-document-session-types';
	import type { SharedTarget } from '../../../../../lib/infrastructure/document/shared-document-command';
	import { sharedTextarea } from '../../../document/shared-textarea';
	let {
		client,
		target,
		field,
		label,
		rows = 3,
	}: {
		client: CollaborativeDocumentSession;
		target: SharedTarget;
		field: string;
		label: string;
		rows?: number;
	} = $props();
	const text = $derived(client.text(target, field));
</script>

{#if text}{#key text}
		<textarea
			aria-label={label}
			{rows}
			use:sharedTextarea={{
				text,
				edit: (next) => {
					client.updateText(target, field, next);
				},
				merge: (update) => {
					client.applyLocalTextUpdate(update);
				},
			}}></textarea>
	{/key}{/if}

<style>
	textarea {
		width: 100%;
		padding: 8px;
		border: 1px solid #d6d3d1;
		border-radius: 6px;
		resize: vertical;
		background: white;
	}
</style>
