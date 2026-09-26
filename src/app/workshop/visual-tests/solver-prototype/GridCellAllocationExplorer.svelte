<script lang="ts">
	import { CrossingAllocationPhaseId } from '../../../../lib/core/layout/grid-cell-crossing-phases';
	import { gridCrossingAllocationDemos } from '../../solver-prototype/grid-cell-allocation';

	const demos = gridCrossingAllocationDemos();

	function phaseLabel(id: CrossingAllocationPhaseId): string {
		switch (id) {
			case CrossingAllocationPhaseId.Reallocate:
				return 'Réaffectation';
			case CrossingAllocationPhaseId.ExtraTrack:
				return 'Piste supplémentaire';
			case CrossingAllocationPhaseId.Bridge:
				return 'Pont validé';
			default:
				return 'Phase inconnue';
		}
	}

	function phaseOutcome(
		phase: (typeof demos)[number]['selected']['witness']['phases'][number],
	): string {
		if (!phase.attempted) return 'Non tentée';
		if (phase.truncated) return 'Tronquée';
		if (phase.exhaustive) return 'Exhaustive';
		if (phase.selected) return 'Retenue';
		return 'Arrêtée';
	}

	function points(path: readonly { readonly x: number; readonly y: number }[]): string {
		return path.map(({ x, y }) => `${x},${y}`).join(' ');
	}
</script>

<section
	class="grid-allocation"
	aria-label="Allocation de grille"
	data-testid="grid-allocation-explorer"
>
	<header>
		<p class="eyebrow">Grille · recherche bornée réelle</p>
		<h2>Réaffecter, ajouter une piste, puis tenter le pont</h2>
		<p>
			Chaque carte exécute le solveur de grille et son oracle géométrique. Les rails et bus
			reprennent la couleur de leur relation ; les tableaux rendent visible le candidat
			effectivement retenu, le nombre de géométries explorées et le total déclaré de chaque phase.
			Les routes en conflit sont essayées en premier ; le reste conserve l’ordre canonique.
		</p>
	</header>
	<div class="examples">
		{#each demos as demo (demo.id)}
			<article class="example" data-testid={`grid-allocation-case-${demo.id}`}>
				<div class="example-heading">
					<div>
						<h3>{demo.title}</h3>
						<p>{demo.description}</p>
					</div>
					<p class="winner" data-testid="grid-allocation-winner">
						Phase gagnante · {phaseLabel(demo.winningPhase)}
					</p>
				</div>
				<div class="canvas">
					<svg
						role="img"
						aria-label={`Grille ${demo.selected.cells.length} cellules, routes inter-cellules colorées`}
						viewBox={`0 0 ${demo.selected.layout.width} ${demo.selected.layout.height}`}
					>
						{#each demo.selected.cells as cell (cell.id)}
							<rect
								class="cell"
								x={cell.bounds.x}
								y={cell.bounds.y}
								width={cell.bounds.width}
								height={cell.bounds.height}
								rx="10"
							/>
							<text class="cell-label" x={cell.bounds.x + 12} y={cell.bounds.y + 25}>
								{cell.id.toUpperCase()}
							</text>
						{/each}
						{#each demo.selected.layout.relations as route (route.id)}
							<polyline
								class="route"
								data-testid={`grid-allocation-route-${route.id}`}
								points={points(route.points)}
								stroke={demo.colorsByRelationId.get(route.id)}
							/>
						{/each}
						{#each demo.selected.layout.elements as element (element.id)}
							<rect
								class="endpoint"
								x={element.bounds.x}
								y={element.bounds.y}
								width={element.bounds.width}
								height={element.bounds.height}
								rx="7"
							/>
							<text class="endpoint-label" x={element.bounds.x + 9} y={element.bounds.y + 22}>
								{element.id}
							</text>
						{/each}
					</svg>
				</div>
				<p data-testid="grid-allocation-dimensions">
					Avant {demo.sizeBefore.width} × {demo.sizeBefore.height} px → après
					{demo.selected.layout.width} × {demo.selected.layout.height} px (−{demo.sizeBefore.width -
						demo.selected.layout.width} px de largeur, −{demo.sizeBefore.height -
						demo.selected.layout.height} px de hauteur)
				</p>
				<div class="details">
					<section aria-label="Candidat d’allocation retenu">
						<h4>Candidat retenu</h4>
						<p data-testid="grid-allocation-retained">Bus : {demo.busOrder.join(' → ')}</p>
						<ul class="tracks">
							{#each demo.tracks as track (track.relationId)}
								<li data-testid={`grid-allocation-track-${track.relationId}`}>
									<span class="swatch" style:--track-color={track.color} aria-hidden="true"></span>
									<strong>{track.relationId}</strong>
									<span>bus {track.busTrack} · rails {track.railLabel}</span>
								</li>
							{/each}
						</ul>
					</section>
					<section aria-label="Exploration par phase">
						<h4>Géométries explorées / total déclaré</h4>
						<ul class="phases">
							{#each demo.selected.witness.phases as phase (phase.id)}
								<li
									data-testid={`grid-allocation-phase-${phase.id}`}
									data-exhaustive={phase.exhaustive}
									data-truncated={phase.truncated}
								>
									<span>{phaseLabel(phase.id)}</span>
									<strong>{phase.exploredGeometries} / {phase.totalGeometries}</strong>
									<span>{phaseOutcome(phase)}</span>
								</li>
							{/each}
						</ul>
					</section>
				</div>
			</article>
		{/each}
	</div>
</section>

<style>
	.grid-allocation {
		margin-top: 1.5rem;
		line-height: 1.45;
	}
	.eyebrow {
		margin-bottom: 0.2rem;
		color: var(--color-muted, #6b7280);
		font-size: 0.75rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}
	.grid-allocation h2 {
		margin: 0.2rem 0 0.4rem;
	}
	.grid-allocation header > p:last-child {
		max-width: 70rem;
	}
	.examples {
		display: grid;
		gap: 1rem;
		margin-top: 1.25rem;
	}
	.example {
		min-width: 0;
		padding: 1rem;
		border: 1px solid var(--color-border, #d1d5db);
		border-radius: 14px;
		background: white;
	}
	.example-heading {
		display: flex;
		align-items: start;
		justify-content: space-between;
		gap: 1rem;
	}
	.example-heading h3 {
		margin: 0;
	}
	.example-heading p {
		margin: 0.35rem 0 0;
	}
	.winner {
		flex: 0 0 auto;
		padding: 0.4rem 0.65rem;
		border-radius: 999px;
		background: #e6f3ea;
		color: #20583d;
		font-size: 0.82rem;
		font-weight: 700;
	}
	.canvas {
		overflow: auto;
		margin-top: 0.8rem;
		border: 1px solid #e2e8e3;
		border-radius: 10px;
		background: #fbfcfa;
	}
	svg {
		display: block;
		width: 100%;
		min-width: 560px;
		max-height: 420px;
	}
	.cell {
		fill: #f1f5f1;
		stroke: #82998a;
		stroke-width: 2;
	}
	.cell-label {
		fill: #53675a;
		font-size: 13px;
		font-weight: 700;
	}
	.route {
		fill: none;
		stroke-linecap: round;
		stroke-linejoin: round;
		stroke-width: 5;
	}
	.endpoint {
		fill: white;
		stroke: #566b5d;
		stroke-width: 2;
	}
	.endpoint-label {
		fill: #27382d;
		font-size: 12px;
		font-weight: 600;
	}
	.details {
		display: grid;
		grid-template-columns: minmax(14rem, 0.9fr) minmax(20rem, 1.1fr);
		gap: 1rem;
		margin-top: 0.8rem;
	}
	.details h4 {
		margin: 0 0 0.35rem;
		font-size: 0.9rem;
	}
	.details p {
		margin: 0 0 0.5rem;
		font-size: 0.82rem;
	}
	.tracks,
	.phases {
		display: grid;
		gap: 0.35rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.tracks li,
	.phases li {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-width: 0;
		padding: 0.35rem 0.5rem;
		border-radius: 7px;
		background: #f5f7f5;
		font-size: 0.76rem;
	}
	.tracks li span:last-child {
		margin-left: auto;
		text-align: right;
	}
	.swatch {
		width: 0.8rem;
		height: 0.8rem;
		flex: 0 0 auto;
		border-radius: 3px;
		background: var(--track-color);
	}
	.phases li strong {
		margin-left: auto;
		font-variant-numeric: tabular-nums;
	}
	@media (max-width: 800px) {
		.example-heading,
		.details {
			display: block;
		}
		.winner {
			display: inline-block;
			margin-top: 0.6rem !important;
		}
		.details section + section {
			margin-top: 0.9rem;
		}
	}
</style>
