<script lang="ts">
	import type { PageData } from './$types';
	import { workshopGroups } from './catalogue';
	import WorkshopShell from './WorkshopShell.svelte';

	let { data }: { data: PageData } = $props();
</script>

<WorkshopShell groups={workshopGroups} fixture={data.fixture} />
