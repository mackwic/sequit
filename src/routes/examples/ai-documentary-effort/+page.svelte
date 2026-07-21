<script lang="ts">
	import DocumentPage from '$lib/components/DocumentPage.svelte';

	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<DocumentPage source={data.source} title="AI for documentary effort" />
