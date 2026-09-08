<script lang="ts">
	import { workshopGroups } from './catalogue';
	import type { WorkshopFixture } from './runtime/workshop-fixture';
	import WorkshopShell from './WorkshopShell.svelte';

	let { fixture }: { fixture: WorkshopFixture | null } = $props();
</script>

<WorkshopShell groups={workshopGroups} {fixture} />
