<script lang="ts">
	import type { CanvasSession, EditingCanvasActivity } from '$lib/session/canvas-session.svelte';

	import AlternativeEditor from './AlternativeEditor.svelte';
	let props: {
		editing: EditingCanvasActivity;
		session: CanvasSession;
		viewport: HTMLDivElement | undefined;
	} = $props();
</script>

<AlternativeEditor {...props} inline={false} />
