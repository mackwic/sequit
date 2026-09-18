<script lang="ts">
	import {
		type Bounds,
		type RoutingInspection,
		RoutingPortRole,
	} from '../../../lib/core/layout/layout-types';
	let { inspection }: { inspection: RoutingInspection } = $props();
	function railLine(bounds: Bounds, coordinate: number) {
		if (inspection.vertical)
			return { x1: bounds.x, x2: bounds.x + bounds.width, y1: coordinate, y2: coordinate };
		return { x1: coordinate, x2: coordinate, y1: bounds.y, y2: bounds.y + bounds.height };
	}
	function roleLabel(role: RoutingPortRole) {
		if (role === RoutingPortRole.Incoming) return 'entrant';
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
					data-rail-junctions={rail.junctions?.join(' ')}
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
		{#each node.ports as port, index (`${node.id}-${index}`)}
			<g data-port-node={node.id} data-port-role={port.role}>
				<title
					>{node.id.toUpperCase()} · port {roleLabel(port.role)} · {port.relations.join(
						', ',
					)}</title
				>
				{#if port.role === RoutingPortRole.Incoming}
					<rect
						x={port.point.x - 3}
						y={port.point.y - 3}
						width="6"
						height="6"
						fill="#087e64"
						stroke="white"
					/>
				{:else}<circle
						cx={port.point.x}
						cy={port.point.y}
						r="3.5"
						fill="#8a3da0"
						stroke="white"
					/>{/if}
			</g>
		{/each}
	{/each}
</g>
