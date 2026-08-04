<script lang="ts">
	import type { CanvasModel } from '$lib/canvas/canvas-model';
	import { renderRelationPaths } from '$lib/canvas/render-relations';

	import LogicNode from './LogicNode.svelte';

	let { canvas }: { canvas: CanvasModel } = $props();

	let renderedRelations = $derived(renderRelationPaths(canvas.relations));
</script>

<div class="grid min-h-full min-w-max place-items-center px-16 py-16">
	<div
		class="relative shrink-0"
		data-graph-stage
		data-stage-width={canvas.width}
		data-stage-height={canvas.height}
		style={`width: ${canvas.width}px; height: ${canvas.height}px;`}
	>
		{#each canvas.groups as group (group.id)}
			<section
				class="canvas-group"
				data-group-id={group.id}
				data-endpoint-id={group.id}
				style={`left: ${group.bounds.x}px; top: ${group.bounds.y}px; width: ${group.bounds.width}px; height: ${group.bounds.height}px;`}
			>
				<header>{group.label}</header>
			</section>
		{/each}

		<svg
			class="pointer-events-none absolute inset-0 z-10"
			width={canvas.width}
			height={canvas.height}
			viewBox={`0 0 ${canvas.width} ${canvas.height}`}
			aria-hidden="true"
		>
			<defs>
				<marker
					id="logic-arrow"
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
			{#each renderedRelations as relation (relation.id)}
				<path
					data-relation-id={relation.id}
					data-edge-from={relation.from}
					data-edge-to={relation.to}
					d={relation.path}
					fill="none"
					stroke={relation.color}
					stroke-width="2"
					stroke-linejoin="round"
					stroke-linecap="round"
					marker-end="url(#logic-arrow)"
					vector-effect="non-scaling-stroke"
				></path>
			{/each}
		</svg>

		{#each canvas.nodes as node (node.id)}
			<LogicNode {node} />
		{/each}
		{#each canvas.junctions as junction (junction.id)}
			<div
				class="junction"
				data-junction-id={junction.id}
				data-endpoint-id={junction.id}
				style={`left: ${junction.bounds.x}px; top: ${junction.bounds.y}px; width: ${junction.bounds.width}px; height: ${junction.bounds.height}px;`}
				title={`Junction ${junction.operator.toUpperCase()}`}
			>
				{junction.operator.toUpperCase()}
			</div>
		{/each}
	</div>
</div>

<style>
	.canvas-group {
		position: absolute;
		z-index: 0;
		box-sizing: border-box;
		border: 1px solid #a8a29e;
		border-radius: 0.75rem;
		background: rgb(231 229 228 / 0.52);
	}

	.canvas-group header {
		padding: 0.65rem 0.9rem;
		border-bottom: 1px solid #d6d3d1;
		color: #44403c;
		font-size: 0.75rem;
		font-weight: 700;
	}

	.junction {
		position: absolute;
		z-index: 20;
		display: grid;
		box-sizing: border-box;
		place-items: center;
		border: 2px solid #57534e;
		border-radius: 9999px;
		background: #facc15;
		color: #292524;
		font-size: 0.55rem;
		font-weight: 800;
	}
</style>
