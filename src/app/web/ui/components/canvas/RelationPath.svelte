<script lang="ts">
	import type { RenderedRelation } from '../../canvas/render-relations';
	let {
		relation,
		markerId,
		selected = false,
	}: { relation: RenderedRelation; markerId: string; selected?: boolean } = $props();
</script>

<path
	class:selected
	class="relation-visual"
	data-rendered-relation-id={relation.id}
	data-edge-from={relation.from}
	data-edge-to={relation.to}
	d={relation.path}
	fill="none"
	stroke={relation.color}
	stroke-width="2"
	stroke-linejoin="round"
	stroke-linecap="round"
	marker-end={`url(#${markerId})`}
	vector-effect="non-scaling-stroke"
	aria-hidden="true"
></path>

<style>
	.relation-visual {
		pointer-events: none;
	}
	.relation-visual.selected {
		stroke: var(--ui-accent);
		stroke-width: 4;
	}
</style>
