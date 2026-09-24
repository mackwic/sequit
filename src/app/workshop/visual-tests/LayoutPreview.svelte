<script lang="ts">
	import type { AssertionTargets } from '../../../../tests/support/assertions/assertion-error';
	import type { VisualLayout } from '../../../../tests/support/harnesses/visual-layout';
	import { EndpointKind } from '../../../lib/core/document/logic-document';
	import { renderRelationPaths } from '../../web/ui/canvas/render-relations';
	import JunctionSymbol from '../../web/ui/components/canvas/JunctionSymbol.svelte';
	import RelationArrow from '../../web/ui/components/canvas/RelationArrow.svelte';
	import RelationPath from '../../web/ui/components/canvas/RelationPath.svelte';
	import RoutingReservationDetails from './RoutingReservationDetails.svelte';
	import RoutingReservations from './RoutingReservations.svelte';
	let {
		layout,
		guides,
		reservations = false,
		frame,
		targets = {},
	}: {
		layout: VisualLayout;
		guides: boolean;
		reservations?: boolean;
		frame?: { readonly width: number; readonly height: number };
		targets?: AssertionTargets;
	} = $props();
	const markerId = $props.id();
</script>

<div class="layout-preview">
	{#if (targets.referenceBoxes?.length ?? 0) > 0}
		<p class="assertion-legend">Rouge : sujet en échec · Bleu pointillé : référence</p>
	{/if}
	<svg
		role="img"
		aria-label="Géométrie du scénario"
		viewBox={`0 0 ${frame?.width ?? layout.width} ${frame?.height ?? layout.height}`}
	>
		<RelationArrow id={markerId} />
		{#each renderRelationPaths(layout.relations) as relation (relation.id)}
			<g
				class:assertion-target={targets.routes?.includes(relation.id)}
				data-failed-route={targets.routes?.includes(relation.id)}
			>
				{#if targets.routes?.includes(relation.id)}<title
						>Route {relation.id} concernée par l’assertion en échec</title
					>{/if}
				<RelationPath {relation} {markerId} />
			</g>
		{/each}
		{#each layout.elements as box (box.id)}
			{@const node = box.kind === EndpointKind.Node && layout.getNodeById(box.id)}
			<g
				data-box-id={box.id}
				data-rank={node !== false && node.rank}
				class:assertion-reference={targets.referenceBoxes?.includes(box.id)}
				data-reference-box={targets.referenceBoxes?.includes(box.id)}
				class:assertion-target={targets.boxes?.includes(box.id)}
				data-failed-box={targets.boxes?.includes(box.id)}
			>
				{#if targets.boxes?.includes(box.id)}<title
						>Élément {box.id} concerné par l’assertion en échec</title
					>{/if}
				{#if (targets.referenceBoxes?.includes(box.id) ?? false) && !(targets.boxes?.includes(box.id) ?? false)}<title
						>Élément {box.id} de référence pour la comparaison</title
					>{/if}
				{#if box.kind === EndpointKind.Junction}
					<title>Jonction XOR · {box.id.toUpperCase()}</title>
					<JunctionSymbol
						x={box.bounds.x}
						y={box.bounds.y}
						width={box.bounds.width}
						height={box.bounds.height}
					/>
				{:else}
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
				{/if}
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
		{#if reservations && layout.routingInspection}<RoutingReservations
				inspection={layout.routingInspection}
			/>{/if}
	</svg>
	{#if reservations}
		{#if layout.routingInspection}<RoutingReservationDetails
				{layout}
				inspection={layout.routingInspection}
			/>
		{:else}<p>Les réservations ne sont pas disponibles pour ce dessin.</p>{/if}
	{/if}
</div>

<style>
	.assertion-reference > rect,
	.assertion-reference :global(.junction-outline) {
		stroke: #175cd3;
		stroke-width: 3;
		stroke-dasharray: 6 3;
	}
	.assertion-target > rect,
	.assertion-target :global(.junction-outline) {
		stroke-dasharray: none;
	}
	.assertion-target :global(.relation-visual),
	.assertion-target > rect,
	.assertion-target :global(.junction-outline) {
		stroke: #b42318;
		stroke-width: 3;
	}
	.assertion-target > text {
		fill: #b42318;
	}
</style>
