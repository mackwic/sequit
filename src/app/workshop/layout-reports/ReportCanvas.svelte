<script lang="ts">
	import type {
		LayoutReportZone,
		RenderedLayout,
		ReportedBox,
		ReportedLayout,
		ReportedPoint,
	} from '../../../lib/infrastructure/layout-report/layout-report';
	import { renderRelationPaths } from '../../web/ui/canvas/render-relations';
	import RelationArrow from '../../web/ui/components/canvas/RelationArrow.svelte';
	import RelationPath from '../../web/ui/components/canvas/RelationPath.svelte';
	import type { ReportLayers } from './report-layers';

	let {
		layout,
		rendered,
		replayed,
		zones,
		layers,
	}: {
		layout?: ReportedLayout | undefined;
		rendered?: RenderedLayout | undefined;
		replayed?: ReportedLayout | undefined;
		zones: readonly LayoutReportZone[];
		layers: ReportLayers;
	} = $props();
	const markerId = $props.id();

	let pointed = $derived(
		new Set(zones.flatMap(({ entities }) => entities.map(({ kind, id }) => `${kind}:${id}`))),
	);
	let frame = $derived.by(() => {
		const extents = [layout, rendered, replayed].filter((item) => item !== undefined);
		const corners = zones.map(({ bounds }) => ({
			width: bounds.x + bounds.width,
			height: bounds.y + bounds.height,
		}));
		const sizes = [...extents, ...corners];
		return {
			width: Math.max(1, ...sizes.map(({ width }) => width)),
			height: Math.max(1, ...sizes.map(({ height }) => height)),
		};
	});

	function isPointed(kind: string, id: string): boolean {
		return pointed.has(`${kind}:${id}`);
	}
	function polyline(points: readonly ReportedPoint[]): string {
		return points.map(({ x, y }) => `${x},${y}`).join(' ');
	}
	/** Every box of a geometry, frames first, for an outline layer. */
	function boxes(geometry: ReportedLayout | RenderedLayout): readonly ReportedBox[] {
		return [...geometry.groups, ...geometry.nodes, ...geometry.junctions];
	}
</script>

<svg
	class="report-canvas"
	role="img"
	aria-label="Géométrie du signalement"
	viewBox={`0 0 ${frame.width} ${frame.height}`}
>
	<RelationArrow id={markerId} />
	{#if layout && layers.layout}
		<g data-layer="layout">
			{#each layout.regions as region (region.id)}
				<rect class="region" {...region.bounds} />
			{/each}
			{#each layout.lanes as lane (`${lane.regionId ?? ''}:${lane.id}`)}
				<rect class="lane" {...lane.bounds} />
			{/each}
			{#each layout.groups as group (group.id)}
				<g class="group" class:pointed={isPointed('group', group.id)}>
					<rect {...group.bounds} rx="6" />
					<text x={group.bounds.x + 8} y={group.bounds.y + 16}>{group.id}</text>
				</g>
			{/each}
			{#each renderRelationPaths(layout.relations) as relation (relation.id)}
				<g class:pointed={isPointed('relation', relation.id)} data-relation={relation.id}>
					<title>{relation.id} : {relation.from} → {relation.to}</title>
					<RelationPath {relation} {markerId} />
				</g>
			{/each}
			{#each layout.nodes as node (node.id)}
				<g class="node" class:pointed={isPointed('node', node.id)}>
					<rect {...node.bounds} rx="5" />
					<text x={node.bounds.x + 8} y={node.bounds.y + 18}>{node.id}</text>
				</g>
			{/each}
			{#each layout.junctions as junction (junction.id)}
				<g class="junction" class:pointed={isPointed('junction', junction.id)}>
					<rect {...junction.bounds} rx="8" />
					<title>{junction.id}</title>
				</g>
			{/each}
		</g>
	{/if}
	{#if rendered && layers.rendered}
		<g data-layer="rendered">
			{#each boxes(rendered) as box (box.id)}
				<rect class="rendered" {...box.bounds} rx="4" />
			{/each}
			{#each rendered.relations as relation (relation.id)}
				<path class="rendered" d={relation.path} />
			{/each}
		</g>
	{/if}
	{#if replayed && layers.replayed}
		<g data-layer="replayed">
			{#each boxes(replayed) as box (box.id)}
				<rect class="replayed" {...box.bounds} rx="4" />
			{/each}
			{#each replayed.relations as relation (relation.id)}
				<polyline class="replayed" points={polyline(relation.points)} />
			{/each}
		</g>
	{/if}
	{#if layers.zones}
		<g data-layer="zones">
			{#each zones as zone, index (index)}
				<rect class="zone" {...zone.bounds} />
				<text class="zone-label" x={zone.bounds.x + 4} y={zone.bounds.y + 14}>{index + 1}</text>
			{/each}
		</g>
	{/if}
</svg>

<style>
	.report-canvas {
		display: block;
		width: 100%;
		height: auto;
		background: #fff;
		border: 1px solid #d8ded2;
		border-radius: 8px;
	}
	text {
		font:
			600 11px system-ui,
			sans-serif;
		fill: #243e32;
	}
	.region {
		fill: none;
		stroke: #b8c4b9;
		stroke-dasharray: 6 4;
	}
	.lane {
		fill: #f3f5ef;
		stroke: #dfe5da;
	}
	.group rect {
		fill: none;
		stroke: #87978b;
	}
	.node rect {
		fill: #f4f7ef;
		stroke: #456858;
	}
	.junction rect {
		fill: #facc15;
		stroke: #57534e;
	}
	.pointed rect {
		stroke: #b42318;
		stroke-width: 3;
	}
	.pointed :global(.relation-visual) {
		stroke: #b42318;
		stroke-width: 4;
	}
	.rendered,
	.replayed {
		fill: none;
		stroke-width: 2;
		stroke-dasharray: 5 4;
		vector-effect: non-scaling-stroke;
	}
	.rendered {
		stroke: #c2410c;
	}
	.replayed {
		stroke: #175cd3;
	}
	.zone {
		fill: rgb(180 35 24 / 10%);
		stroke: #b42318;
		stroke-width: 2;
	}
	.zone-label {
		fill: #b42318;
	}
</style>
