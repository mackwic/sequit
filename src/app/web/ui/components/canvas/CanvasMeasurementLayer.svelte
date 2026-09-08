<script lang="ts">
	import type { CanvasMeasurementModel } from '../../canvas/canvas-model';
	import LogicNode from './LogicNode.svelte';

	let {
		model,
		element = $bindable(),
	}: { model: CanvasMeasurementModel; element?: HTMLDivElement | undefined } = $props();
</script>

<div class="measurement-layer" bind:this={element} aria-hidden="true">
	{#each model.nodes as node (node.id)}
		<LogicNode {node} measuring />
	{/each}
	{#each model.groups as group (group.id)}
		<span class="measure-group" data-measure-group={group.id}>{group.label}</span>
	{/each}
	{#each model.junctions as junction (junction.id)}
		<span class="measure-junction" data-measure-junction={junction.id}>{junction.operator}</span>
	{/each}
</div>

<style>
	.measurement-layer {
		position: fixed;
		top: 0;
		left: -10000px;
		display: grid;
		width: 240px;
		gap: 16px;
		visibility: hidden;
		pointer-events: none;
	}

	.measure-group {
		width: max-content;
		font-size: 0.75rem;
		font-weight: 700;
	}

	.measure-junction {
		display: grid;
		width: 32px;
		height: 32px;
		place-items: center;
	}
</style>
