<script lang="ts">
	import type { VisualLayout } from '../../../../tests/support/harnesses/visual-layout';
	import {
		type Bounds,
		type InspectedNode,
		type RoutingInspection,
		RoutingPortRole,
	} from '../../../lib/core/layout/layout-types';
	let { layout, inspection }: { layout: VisualLayout; inspection: RoutingInspection } = $props();
	const rounded = (value: number) => Number(value.toFixed(2));
	function transverseSize(bounds: Bounds) {
		if (inspection.vertical) return bounds.width;
		return bounds.height;
	}
	function primarySize(bounds: Bounds) {
		if (inspection.vertical) return bounds.height;
		return bounds.width;
	}
	function demand(node: InspectedNode, role: RoutingPortRole) {
		if (!node.ports.some((port) => port.role === role)) return '—';
		let minimum = node.outgoingMinimum;
		if (role === RoutingPortRole.Incoming) minimum = node.incomingMinimum;
		return minimum || 'Central';
	}
</script>

<section class="reservation-details" aria-label="Réservations de routage">
	<p class="legend">
		<span class="incoming">■ Ports entrants</span> <span class="outgoing">● Ports sortants</span>
		<span class="rails">┄ Rails et intervalle</span>
		<span class="content">┄ Dimension du contenu</span>
	</p>
	<p>
		Mesures sur l’axe transversal : {#if inspection.vertical}largeur{:else}hauteur{/if}. La
		dimension finale est le maximum du contenu et des besoins des deux faces. « Central » signifie
		qu’aucun minimum supplémentaire n’a été réservé sur cette face.
	</p>
	<div class="table-scroll">
		<table>
			<caption>Dimensionnement des nœuds et jonctions</caption>
			<thead
				><tr
					><th>Objet</th><th>Contenu</th><th>Minimum entrant</th><th>Minimum sortant</th><th
						>Final</th
					><th>Ajout</th></tr
				></thead
			>
			<tbody
				>{#each inspection.nodes as node (node.id)}
					{@const box = layout.getById(node.id).bounds}
					{@const content = transverseSize(node.content)}
					{@const final = transverseSize(box)}
					<tr data-reservation-node={node.id}
						><th scope="row">{node.id.toUpperCase()}</th><td>{rounded(content)}</td><td
							>{demand(node, RoutingPortRole.Incoming)}</td
						><td>{demand(node, RoutingPortRole.Outgoing)}</td><td>{rounded(final)}</td><td
							>+{rounded(final - content)}</td
						></tr
					>
				{/each}</tbody
			>
		</table>
	</div>
	{#each inspection.corridors as corridor (corridor.rank)}
		<p data-reservation-gap={corridor.rank}>
			<strong>Rangs {corridor.rank + 1} → {corridor.rank + 2}</strong> · {corridor.rails.length} rail(s)
			utilisé(s) · minimum réservé {corridor.requiredGap} · intervalle disponible {rounded(
				primarySize(corridor.bounds),
			)}.
			{#if !corridor.allocated}Routage par défaut : rails observés sur les segments transversaux.{/if}
		</p>
	{/each}
	<p class="note">
		Les points montrent les ports utilisés. Le contour du contenu indique sa dimension mesurée, sans
		simuler la position du texte. Les rails montrent les traverses et les centres des jonctions dans
		chaque intervalle entre rangées.
	</p>
</section>

<style>
	.reservation-details {
		padding: 1rem;
		font-size: 0.85rem;
		line-height: 1.5;
		background: var(--surface, #f4f7ef);
	}
	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 1rem;
	}
	.incoming {
		color: #087e64;
	}
	.outgoing {
		color: #8a3da0;
	}
	.rails {
		color: #2764a5;
	}
	.content {
		color: #a76b16;
	}
	.table-scroll {
		overflow-x: auto;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		font-variant-numeric: tabular-nums;
	}
	caption {
		text-align: left;
		font-weight: 600;
	}
	th,
	td {
		padding: 0.4rem;
		text-align: left;
		border-bottom: 1px solid #bacbbb;
		white-space: nowrap;
	}
	.note {
		opacity: 0.8;
	}
</style>
