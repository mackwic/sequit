<script lang="ts">
	import { PREVIEW_STAGE, type PreviewNode } from '$lib/canvas/preview-graph';

	let { node }: { node: PreviewNode } = $props();
</script>

<article
	class="node-card absolute overflow-hidden bg-white"
	data-node-id={node.id}
	style={`--nature-color: ${node.nature.color}; left: ${node.x}px; top: ${node.y}px; width: ${PREVIEW_STAGE.nodeWidth}px; height: ${PREVIEW_STAGE.nodeHeight}px;`}
>
	<header>{node.nature.label}</header>
	<p>{node.content}</p>
</article>

<style>
	.node-card {
		border: 1px solid color-mix(in srgb, var(--nature-color) 35%, #d6d3d1);
		border-radius: 0.75rem;
		box-shadow:
			0 1px 2px rgb(28 25 23 / 0.06),
			0 8px 24px rgb(28 25 23 / 0.06);
	}

	header {
		border-bottom: 1px solid color-mix(in srgb, var(--nature-color) 25%, white);
		background: color-mix(in srgb, var(--nature-color) 13%, white);
		padding: 0.55rem 0.75rem;
		color: color-mix(in srgb, var(--nature-color) 82%, black);
		font-size: 0.7rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}

	p {
		margin: 0;
		padding: 0.9rem 0.75rem 1rem;
		color: #292524;
		font-size: 0.875rem;
		line-height: 1.45;
	}
</style>
