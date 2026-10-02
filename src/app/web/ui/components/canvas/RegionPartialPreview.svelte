<script lang="ts">
	import { m } from '../../../i18n/paraglide/messages';
	import type { CanvasModel } from '../../canvas/canvas-model';

	let { canvas }: { canvas: CanvasModel } = $props();
</script>

<svg
	class="h-60 w-full rounded-md border border-stone-300 bg-white"
	viewBox={`0 0 ${canvas.width} ${canvas.height}`}
	role="img"
	aria-label={m.canvas_region_preview()}
	data-region-preview-geometry
>
	{#each canvas.lanes ?? [] as lane (lane.id)}
		<rect
			x={lane.bounds.x}
			y={lane.bounds.y}
			width={lane.bounds.width}
			height={lane.bounds.height}
			fill="#eef2ff"
			stroke="#a5b4fc"
		/>
	{/each}
	{#each canvas.relations as relation (relation.id)}
		<polyline
			points={relation.points.map(({ x, y }) => `${x},${y}`).join(' ')}
			fill="none"
			stroke="#475569"
			stroke-width="2"
			data-preview-relation-id={relation.id}
		/>
	{/each}
	{#each canvas.groups as group (group.id)}
		<rect
			x={group.bounds.x}
			y={group.bounds.y}
			width={group.bounds.width}
			height={group.bounds.height}
			fill="#f5f5f4"
			stroke="#78716c"
			data-preview-group-id={group.id}
		/>
	{/each}
	{#each canvas.nodes as node (node.id)}
		<g data-preview-node-id={node.id}>
			<rect
				x={node.bounds.x}
				y={node.bounds.y}
				width={node.bounds.width}
				height={node.bounds.height}
				rx="8"
				fill="white"
				stroke={node.nature.color}
				stroke-width="2"
			/>
			<text x={node.bounds.x + 8} y={node.bounds.y + node.bounds.height / 2} font-size="12">
				{node.id}
			</text>
		</g>
	{/each}
	{#each canvas.junctions as junction (junction.id)}
		<circle
			cx={junction.bounds.x + junction.bounds.width / 2}
			cy={junction.bounds.y + junction.bounds.height / 2}
			r={Math.min(junction.bounds.width, junction.bounds.height) / 2}
			fill="white"
			stroke="#475569"
			data-preview-junction-id={junction.id}
		/>
	{/each}
</svg>
