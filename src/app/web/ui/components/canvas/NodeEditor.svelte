<script lang="ts">
	import type { Snippet } from 'svelte';

	import type { LayoutLane, LogicNature } from '../../../../../lib/core/document/logic-document';
	import type { NodeFields } from '../../../../../lib/infrastructure/document/node-fields';
	import {
		CanvasEditAvailability,
		type CanvasSession,
		type EditingCanvasActivity,
	} from '../../session/canvas-session.svelte';
	import NodeDialog from './NodeDialog.svelte';

	let {
		editing,
		session,
		natures,
		lanes = [],
		description,
		text,
	}: {
		editing: EditingCanvasActivity;
		session: CanvasSession;
		natures: readonly LogicNature[];
		lanes?: readonly LayoutLane[];
		description?: string | undefined;
		/** Live shared text fields, when the session edits text in place. */
		text?: Snippet;
	} = $props();
</script>

{#key editing.nodeId}
	<NodeDialog
		mode="edit"
		{natures}
		{lanes}
		draft={editing.draft}
		busy={editing.saving}
		deleted={editing.availability === CanvasEditAvailability.Deleted}
		diagnostic={editing.diagnostic}
		{description}
		data={{ 'data-node-editor': editing.nodeId }}
		onchange={(patch: Partial<NodeFields>) => session.updateDraft(patch)}
		onsubmit={() => {
			void session.saveDraft();
		}}
		onclose={() => session.cancel()}
		{text}
	/>
{/key}
