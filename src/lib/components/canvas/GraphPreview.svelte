<script lang="ts">
	import {
		PREVIEW_STAGE,
		previewConnections,
		previewNodes
	} from '$lib/canvas/preview-graph';
	import LogicNode from './LogicNode.svelte';
</script>

<div class="canvas-grid absolute inset-0 overflow-auto">
	<div class="grid min-h-full min-w-max place-items-center px-24 py-20">
		<div
			class="relative shrink-0"
			data-graph-stage
			style={`width: ${PREVIEW_STAGE.width}px; height: ${PREVIEW_STAGE.height}px;`}
		>
			<svg
				class="pointer-events-none absolute inset-0"
				width={PREVIEW_STAGE.width}
				height={PREVIEW_STAGE.height}
				viewBox={`0 0 ${PREVIEW_STAGE.width} ${PREVIEW_STAGE.height}`}
				aria-hidden="true"
			>
				<defs>
					<marker
						id="arrow"
						viewBox="0 0 10 10"
						refX="9"
						refY="5"
						markerWidth="9"
						markerHeight="9"
						markerUnits="userSpaceOnUse"
						orient="auto"
					>
						<path d="M 0 0 L 10 5 L 0 10 z" fill="#a8a29e"></path>
					</marker>
				</defs>

				{#each previewConnections as connection (`${connection.from}-${connection.to}`)}
					<path
						data-edge={`${connection.from}-${connection.to}`}
						data-edge-from={connection.from}
						data-edge-to={connection.to}
						d={connection.path}
						fill="none"
						stroke="#a8a29e"
						stroke-width="2"
						stroke-linecap="round"
						marker-end="url(#arrow)"
						vector-effect="non-scaling-stroke"
					></path>
				{/each}
			</svg>

			{#each previewNodes as node (node.id)}
				<LogicNode {node} />
			{/each}
		</div>
	</div>
</div>

<style>
	.canvas-grid {
		background-color: #f5f5f4;
		background-image: radial-gradient(#d6d3d1 0.8px, transparent 0.8px);
		background-size: 20px 20px;
	}
</style>
