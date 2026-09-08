<script lang="ts">
	import DocumentPage from '../../../app/web/ui/components/DocumentPage.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<DocumentPage source={data.source} title="AI for documentary effort" />
