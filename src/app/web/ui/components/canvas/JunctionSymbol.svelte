<script lang="ts">
	import { JunctionOperator } from '../../../../../lib/core/document/logic-document';

	let {
		width,
		height,
		x = 0,
		y = 0,
		operator = JunctionOperator.Xor,
	}: {
		width: number;
		height: number;
		x?: number;
		y?: number;
		operator?: JunctionOperator;
	} = $props();
</script>

<svg
	{x}
	{y}
	{width}
	{height}
	viewBox={`0 0 ${width} ${height}`}
	aria-hidden="true"
	data-junction-symbol={operator}
>
	<rect
		class="junction-outline"
		x="0.75"
		y="0.75"
		width={Math.max(0, width - 1.5)}
		height={Math.max(0, height - 1.5)}
		rx={Math.min(width, height) / 2}
		fill="#facc15"
		stroke="#57534e"
		stroke-width="1.5"
	/>
	<text
		x={width / 2}
		y={height / 2}
		text-anchor="middle"
		dominant-baseline="central"
		fill="#292524"
		font-size="6.5"
		font-weight="700">{operator.toUpperCase()}</text
	>
</svg>

<style>
	svg {
		display: block;
	}
</style>
