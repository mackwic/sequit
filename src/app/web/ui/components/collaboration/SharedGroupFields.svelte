<script lang="ts">
	import type { LogicGroup } from '../../../../../lib/core/document/logic-document';
	import type { CollaborativeDocumentSession } from '../../../../../lib/infrastructure/collaboration/collaborative-document-session-types';
	import {
		SharedCommandKind as Op,
		type SharedDocumentCommand,
		SharedElementKind as Kind,
	} from '../../../../../lib/infrastructure/document/shared-document-command';
	import ContentColorPicker from '../content/ContentColorPicker.svelte';
	import SharedTextField from './SharedTextField.svelte';

	let {
		group,
		client,
		connected,
		dispatch,
	}: {
		group: LogicGroup;
		client: CollaborativeDocumentSession;
		connected: boolean;
		dispatch: (command: SharedDocumentCommand) => void;
	} = $props();

	function updateColor(color: string): void {
		if (!connected) return;
		dispatch({
			op: Op.Update,
			target: { kind: Kind.Group, id: group.id },
			set: { color },
			unset: [],
		});
	}
</script>

{#key client.text({ kind: Kind.Group, id: group.id }, 'label')}
	<SharedTextField
		{client}
		{connected}
		target={{ kind: Kind.Group, id: group.id }}
		field="label"
		label="Titre du groupe"
		autofocus
	/>
{/key}
<div class:disabled={!connected}>
	<strong>Couleur</strong>
	<ContentColorPicker value={group.color ?? '#78716c'} onchange={updateColor} />
</div>

<style>
	strong {
		display: block;
		margin-bottom: 8px;
		font-size: 13px;
	}
	.disabled {
		pointer-events: none;
		opacity: 0.5;
	}
</style>
