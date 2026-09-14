<script lang="ts">
	import type { LogicDocument } from '../../../../../lib/core/document/logic-document';
	import type { CollaborativeDocumentSession } from '../../../../../lib/infrastructure/collaboration/collaborative-document-session-types';
	import {
		SharedCommandKind as Op,
		type SharedDocumentCommand,
		SharedElementKind as Kind,
	} from '../../../../../lib/infrastructure/document/shared-document-command';
	import SharedPropertyFields from './SharedPropertyFields.svelte';
	import SharedTextField from './SharedTextField.svelte';
	let {
		node,
		client,
		connected,
		dispatch,
		label,
	}: {
		node: LogicDocument['nodes'][number];
		client: CollaborativeDocumentSession;
		connected: boolean;
		dispatch: (command: SharedDocumentCommand) => void;
		label: string;
	} = $props();
</script>

<header>
	<strong>{node.id}</strong><button
		type="button"
		disabled={!connected}
		onclick={() => {
			dispatch({ op: Op.Delete, target: { kind: Kind.Node, id: node.id } });
		}}>Supprimer {node.id}</button
	>
</header>
<SharedTextField {client} target={{ kind: Kind.Node, id: node.id }} field="markdown" {label} />
<SharedTextField
	{client}
	target={{ kind: Kind.Node, id: node.id }}
	field="description"
	label={`Description de ${node.id}`}
/>
<SharedPropertyFields
	target={{ kind: Kind.Node, id: node.id }}
	properties={{
		natureId: node.natureId,
		groupId: node.groupId,
		color: node.color,
		icon: node.icon,
	}}
	{connected}
	{dispatch}
/>

<style>
	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	button {
		padding: 5px 10px;
		border: 1px solid #d6d3d1;
		border-radius: 6px;
		background: white;
		cursor: pointer;
	}
	button:disabled {
		opacity: 0.5;
	}
</style>
