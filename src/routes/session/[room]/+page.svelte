<script lang="ts">
	import SessionPage from '../../../app/web/ui/components/SessionPage.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

{#key data.room}
	<SessionPage room={data.room} />
{/key}
