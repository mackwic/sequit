<script lang="ts">
	import type { LogicDocument } from '../../../../../lib/core/document/logic-document';
	import type { CollaborativeDocumentSession } from '../../../../../lib/infrastructure/collaboration/collaborative-document-session-types';
	import { SharedElementKind as Kind } from '../../../../../lib/infrastructure/document/shared-document-command';
	import SharedTextField from './SharedTextField.svelte';
	let {
		node,
		client,
		textEditable,
		label,
		autofocusMarkdown = false,
	}: {
		node: LogicDocument['nodes'][number];
		client: CollaborativeDocumentSession;
		textEditable: boolean;
		label: string;
		autofocusMarkdown?: boolean;
	} = $props();
	const target = $derived({ kind: Kind.Node, id: node.id });
</script>

{#key client.text(target, 'markdown')}
	<SharedTextField
		{client}
		connected={textEditable}
		{target}
		field="markdown"
		{label}
		autofocus={autofocusMarkdown}
	/>
{/key}
{#key client.text(target, 'description')}
	<SharedTextField
		{client}
		connected={textEditable}
		{target}
		field="description"
		label={`Description de ${node.id}`}
	/>
{/key}
