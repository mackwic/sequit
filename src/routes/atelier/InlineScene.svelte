<script lang="ts">
	import Editor from './InlineEditor.svelte';
	import Playground from './Playground.svelte';
	import type { WorkshopSceneProps } from './workshop-types';
	let props: WorkshopSceneProps = $props();
</script>

<Playground {...props} editor={Editor} />
