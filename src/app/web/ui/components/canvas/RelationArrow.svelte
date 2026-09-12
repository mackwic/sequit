<script lang="ts">
	let { id }: { id: string } = $props();
</script>

<defs aria-hidden="true">
	<marker
		{id}
		viewBox="0 0 10 10"
		refX="9"
		refY="5"
		markerWidth="9"
		markerHeight="9"
		markerUnits="userSpaceOnUse"
		orient="auto"
	>
		<path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke"></path>
	</marker>
</defs>
