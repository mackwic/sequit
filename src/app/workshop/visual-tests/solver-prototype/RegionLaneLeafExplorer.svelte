<script lang="ts">
	import { LaneOrientation } from '../../../../lib/core/document/logic-document';
	import type { Point } from '../../../../lib/core/layout/layout-types';
	import { runRegionLaneLeafWitness } from './region-lane-leaf-witness';

	let orientation = $state(LaneOrientation.Parallel);
	const witness = $derived(runRegionLaneLeafWitness(orientation));
	const candidate = $derived(witness.candidate);
	const issue = $derived(witness.reason ?? witness.compositionIssue ?? witness.independentIssue);

	function points(path: readonly Point[]): string {
		return path.map(({ x, y }) => `${x},${y}`).join(' ');
	}

	function regionLabel(id: string): string {
		if (id === 'shared') return 'RÉGION AVEC LANES';
		return 'FEUILLE ORDINAIRE';
	}
</script>

<section class="region-lane-witness" aria-label="Deux lanes dans une feuille de région">
	<div class="heading">
		<div>
			<p class="eyebrow">Composition expérimentale · vrais solveurs feuille et lanes</p>
			<h2>Deux lanes partagées dans une région</h2>
			<p>
				La feuille de gauche contient deux lanes et une relation locale entre elles. La feuille
				voisine conserve son classement et son layout propres. Les trois nœuds ont des mesures
				fractionnaires ; le témoin vérifie les translations des boîtes, des lanes et de la route,
				ainsi que leur confinement.
			</p>
		</div>
		<p class:failed={issue !== undefined} class="status" data-testid="region-lane-status">
			{#if issue === undefined}
				Validé · 2 régions · 2 lanes · 1 route locale
			{:else}
				Inconnu · {issue}
			{/if}
		</p>
	</div>

	<div class="controls" role="group" aria-label="Orientation des lanes">
		<button
			type="button"
			class:active={orientation === LaneOrientation.Parallel}
			aria-pressed={orientation === LaneOrientation.Parallel}
			onclick={() => (orientation = LaneOrientation.Parallel)}>Parallèle</button
		>
		<button
			type="button"
			class:active={orientation === LaneOrientation.Transverse}
			aria-pressed={orientation === LaneOrientation.Transverse}
			onclick={() => (orientation = LaneOrientation.Transverse)}>Transverse</button
		>
	</div>

	{#if candidate}
		<div class="metrics" aria-label="Classements locaux">
			<span>Demande : rang {candidate.localRanks.get('request')}</span>
			<span>Livraison : rang {candidate.localRanks.get('delivery')}</span>
			<span>Voisin : rang {candidate.localRanks.get('neighbor')}</span>
		</div>
		<div class="canvas">
			<svg
				role="img"
				aria-label="Deux lanes partagées dans la région de gauche et une feuille ordinaire à droite"
				viewBox={`0 0 ${candidate.selected.layout.width} ${candidate.selected.layout.height}`}
			>
				{#each candidate.selected.regions as region (region.id)}
					<rect
						class="region"
						class:ordinary={region.id === 'ordinary'}
						data-testid={`region-${region.id}`}
						x={region.bounds.x}
						y={region.bounds.y}
						width={region.bounds.width}
						height={region.bounds.height}
						rx="12"
					/>
					<text class="region-label" x={region.bounds.x + 14} y={region.bounds.y + 23}>
						{regionLabel(region.id)}
					</text>
				{/each}
				{#each candidate.lanes as lane (lane.id)}
					<rect
						class="lane"
						data-testid={`lane-${lane.localId}`}
						x={lane.bounds.x}
						y={lane.bounds.y}
						width={lane.bounds.width}
						height={lane.bounds.height}
						rx="8"
					/>
					<text class="lane-label" x={lane.bounds.x + 10} y={lane.bounds.y + 20}>
						{lane.label}
					</text>
				{/each}
				{#each candidate.selected.layout.relations as relation (relation.id)}
					<polyline class="route-halo" points={points(relation.points)} />
					<polyline
						class="route"
						data-testid={`route-${relation.id}`}
						points={points(relation.points)}
					/>
				{/each}
				{#each candidate.selected.layout.elements as element (element.id)}
					<rect
						class="node"
						data-testid={`node-${element.id}`}
						x={element.bounds.x}
						y={element.bounds.y}
						width={element.bounds.width}
						height={element.bounds.height}
						rx="7"
					/>
					<text class="node-label" x={element.bounds.x + 10} y={element.bounds.y + 25}>
						{element.id}
					</text>
				{/each}
			</svg>
		</div>
		<p class="scope">
			Témoin d'atelier composé en mémoire. Le document persistant et le moteur du canvas de
			production ne sélectionnent pas encore des lanes dans une feuille de région.
		</p>
	{/if}
</section>

<style>
	.region-lane-witness {
		margin-top: 1.5rem;
		padding: 1.5rem;
		border: 1px solid #d3dcd3;
		border-radius: 16px;
		background: #fff;
	}
	.heading {
		display: flex;
		align-items: start;
		justify-content: space-between;
		gap: 2rem;
	}
	.heading h2 {
		margin: 0.25rem 0 0.5rem;
		font-size: 1.5rem;
	}
	.heading p {
		max-width: 60rem;
		line-height: 1.5;
	}
	.eyebrow {
		margin: 0;
		color: #5f756a;
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}
	.status {
		flex-shrink: 0;
		margin: 0;
		padding: 0.5rem 0.8rem;
		border-radius: 999px;
		background: #e5f3e8;
		color: #246747;
		font-size: 0.78rem;
		font-weight: 700;
	}
	.status.failed {
		background: #fce9e5;
		color: #9a3d33;
	}
	.controls {
		display: flex;
		gap: 0.5rem;
		margin: 1rem 0;
	}
	.controls button {
		padding: 0.4rem 0.7rem;
		border: 1px solid #becfc3;
		border-radius: 7px;
		background: #fff;
		color: #3d5c49;
		cursor: pointer;
	}
	.controls button.active {
		background: #def0e4;
		border-color: #5f9b75;
		font-weight: 700;
	}
	.metrics {
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem;
		margin: 1rem 0;
	}
	.metrics span {
		padding: 0.4rem 0.7rem;
		border: 1px solid #dce4dd;
		border-radius: 8px;
		background: #f7faf7;
		font-size: 0.75rem;
		font-variant-numeric: tabular-nums;
	}
	.canvas {
		overflow: auto;
		border: 1px solid #e1e6df;
		border-radius: 12px;
		background: #fbfcfa;
	}
	svg {
		display: block;
		width: 100%;
		min-width: 800px;
		height: auto;
	}
	.region {
		fill: #eaf5ed;
		stroke: #609674;
		stroke-width: 2;
	}
	.region.ordinary {
		fill: #f1f2fa;
		stroke: #8b93bd;
	}
	.region-label {
		fill: #365b42;
		font-size: 12px;
		font-weight: 700;
		letter-spacing: 0.8px;
	}
	.lane {
		fill: #fcfdfb;
		stroke: #91b79d;
		stroke-width: 1.5;
	}
	.lane-label {
		fill: #66836d;
		font-size: 12px;
		font-weight: 700;
	}
	.route-halo {
		fill: none;
		stroke: #fff;
		stroke-linecap: round;
		stroke-linejoin: round;
		stroke-width: 10;
	}
	.route {
		fill: none;
		stroke: #684fba;
		stroke-linecap: round;
		stroke-linejoin: round;
		stroke-width: 4;
	}
	.node {
		fill: #fff;
		stroke: #576d60;
		stroke-width: 2;
	}
	.node-label {
		fill: #293d31;
		font-size: 13px;
		font-weight: 700;
	}
	.scope {
		margin-bottom: 0;
		color: #5d6c61;
		font-size: 0.82rem;
	}
</style>
