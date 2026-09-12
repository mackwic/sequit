<script lang="ts">
	import {
		type Bounds,
		type RoutingInspection,
		RoutingQuaySide,
	} from '../../../lib/core/layout/layout-types';
	let { inspection }: { inspection: RoutingInspection } = $props();
	function railLine(bounds: Bounds, coordinate: number) {
		if (inspection.vertical)
			return { x1: bounds.x, x2: bounds.x + bounds.width, y1: coordinate, y2: coordinate };
		return { x1: coordinate, x2: coordinate, y1: bounds.y, y2: bounds.y + bounds.height };
	}
	function sideLabel(side: RoutingQuaySide) {
		if (side === RoutingQuaySide.Incoming) return 'entrant';
		return 'sortant';
	}
</script>

<g class="routing-reservations" pointer-events="none">
	{#each inspection.corridors as corridor (corridor.rank)}
		<g data-reserved-corridor={corridor.rank}>
			<title
				>Rangs {corridor.rank + 1} et {corridor.rank + 2} : minimum réservé {corridor.requiredGap}</title
			>
			<rect
				{...corridor.bounds}
				fill="#2764a5"
				fill-opacity="0.06"
				stroke="#2764a5"
				stroke-dasharray="2 5"
			/>
			{#each corridor.rails as rail (rail.coordinate)}
				<line
					data-reserved-rail={rail.coordinate}
					{...railLine(corridor.bounds, rail.coordinate)}
					stroke="#2764a5"
					stroke-width="1"
					stroke-dasharray="5 5"
				/>
			{/each}
		</g>
	{/each}
	{#each inspection.nodes as node (node.id)}
		<rect
			data-content-outline={node.id}
			{...node.content}
			fill="none"
			stroke="#a76b16"
			stroke-dasharray="2 3"
			rx="3"
		/>
		{#each node.quays as quay, index (`${node.id}-${index}`)}
			<g data-quay-node={node.id} data-quay-side={quay.side}>
				<title
					>{node.id.toUpperCase()} · quai {sideLabel(quay.side)} · {quay.relations.join(
						', ',
					)}</title
				>
				{#if quay.side === RoutingQuaySide.Incoming}
					<rect
						x={quay.point.x - 3}
						y={quay.point.y - 3}
						width="6"
						height="6"
						fill="#087e64"
						stroke="white"
					/>
				{:else}<circle
						cx={quay.point.x}
						cy={quay.point.y}
						r="3.5"
						fill="#8a3da0"
						stroke="white"
					/>{/if}
			</g>
		{/each}
	{/each}
</g>
