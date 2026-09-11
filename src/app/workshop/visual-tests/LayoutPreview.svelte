<script lang="ts">
	import { EndpointKind } from '../../../lib/core/document/logic-document';
	import type { VisualLayout } from './visual-layout';
	let { layout, guides }: { layout: VisualLayout; guides: boolean } = $props();
	const markerId = $props.id();
</script>

<div class="layout-preview">
	<svg
		role="img"
		aria-label="Géométrie du scénario"
		viewBox={`0 0 ${layout.width} ${layout.height}`}
	>
		<defs
			><marker id={markerId} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"
				><path d="M 0 0 L 8 4 L 0 8 Z" fill="#456858" /></marker
			></defs
		>
		{#each layout.relations as relation (relation.id)}
			<polyline
				points={relation.points.map((point) => `${point.x},${point.y}`).join(' ')}
				fill="none"
				stroke="#456858"
				stroke-width="2"
				marker-end={`url(#${markerId})`}
			/>
		{/each}
		{#each layout.elements as box (box.id)}
			{@const node = box.kind === EndpointKind.Node && layout.getNodeById(box.id)}
			<g data-box-id={box.id} data-rank={node !== false && node.rank}>
				<rect
					x={box.bounds.x}
					y={box.bounds.y}
					width={box.bounds.width}
					height={box.bounds.height}
					rx="5"
					fill="#f4f7ef"
					stroke="#456858"
				/>
				<text
					x={box.bounds.x + 10}
					y={box.bounds.y + 23}
					fill="#243e32"
					font-size="12"
					font-weight="600"
					>{box.id.toUpperCase()}{#if node}
						· rang {node.rank}{/if}</text
				>
				<text x={box.bounds.x + 10} y={box.bounds.y + 43} fill="#66756b" font-size="10"
					>{box.bounds.width} × {box.bounds.height}</text
				>
				{#if guides}
					<g data-center-guide={box.id}>
						<line
							x1={box.bounds.x + box.bounds.width / 2}
							x2={box.bounds.x + box.bounds.width / 2}
							y1={Math.max(0, box.bounds.y - 15)}
							y2={Math.min(layout.height, box.bounds.y + box.bounds.height + 15)}
							stroke="#bb6f28"
							stroke-dasharray="4 3"
						/>
						<line
							x1={Math.max(0, box.bounds.x - 15)}
							x2={Math.min(layout.width, box.bounds.x + box.bounds.width + 15)}
							y1={box.bounds.y + box.bounds.height / 2}
							y2={box.bounds.y + box.bounds.height / 2}
							stroke="#bb6f28"
							stroke-dasharray="4 3"
						/>
						<text
							x={box.bounds.x + box.bounds.width / 2 + 5}
							y={box.bounds.y - 5}
							fill="#97591f"
							font-size="9"
							>({box.bounds.x + box.bounds.width / 2}, {box.bounds.y + box.bounds.height / 2})</text
						>
					</g>
				{/if}
			</g>
		{/each}
	</svg>
</div>
