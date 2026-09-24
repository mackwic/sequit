<script lang="ts">
	import { conditionalPortConflicts } from '../../solver-prototype/conditional-port-conflicts';
	import { threeIncidenceFaceCapacity } from '../../solver-prototype/face-capacity';

	let routeSet = $state<'complete' | 'parallel'>('complete');
	let passage = $state<'monotone-adjacent-corridor' | 'other-passage'>(
		'monotone-adjacent-corridor',
	);
	const sources = ['a', 'b', 'c'];
	const targets = ['d', 'e'];
	const relations = $derived.by(() => {
		if (routeSet === 'complete')
			return sources.flatMap((from) => targets.map((to) => ({ id: `${from}-${to}`, from, to })));
		return [
			{ id: 'a-d', from: 'a', to: 'd' },
			{ id: 'b-e', from: 'b', to: 'e' },
		];
	});
	const conflicts = $derived(
		conditionalPortConflicts({
			sourceRank: 1,
			targetRank: 0,
			sourceOrder: sources,
			targetOrder: targets,
			relations,
			passage,
		}),
	);
	const faceD = $derived.by(() => {
		if (routeSet !== 'complete' || conflicts.status !== 'deduced') return undefined;
		return threeIncidenceFaceCapacity({
			endpointId: 'd',
			role: 'incoming',
			incidences: relations
				.filter(({ to }) => to === 'd')
				.map(({ id, from }) => ({ relationId: id, oppositeEndpointId: from })),
			intrinsicCrossSize: 80,
			inset: 24,
			spacing: 48,
			requiredSeparations: conflicts.requiredSeparations.filter(
				({ endpointId }) => endpointId === 'd',
			),
		});
	});
</script>

<section class="conditional" aria-label="Conflits de ports conditionnels">
	<header>
		<div>
			<p class="eyebrow">Dépendance au rang et au passage</p>
			<h2>Quand trois ports deviennent nécessaires</h2>
			<p>
				Avec un corridor adjacent monotone et l’ordre a &lt; b &lt; c, d &lt; e, une inversion force
				un croisement. La règle de partage du moteur sépare alors les arrivées croisées.
			</p>
		</div>
		<div class="controls">
			<label
				>Relations
				<select bind:value={routeSet}>
					<option value="complete">K3,2 · six relations</option>
					<option value="parallel">Deux relations sans inversion</option>
				</select>
			</label>
			<label
				>Passage candidat
				<select bind:value={passage}>
					<option value="monotone-adjacent-corridor">Adjacent monotone</option>
					<option value="other-passage">Autre passage</option>
				</select>
			</label>
		</div>
	</header>
	<div class="grid">
		<div class="graph">
			<h3>Deux rangs ordonnés, avant coordonnées</h3>
			<svg role="img" aria-label="Relations entre les rangs source et cible" viewBox="0 0 420 290">
				{#each relations as relation (relation.id)}
					<line
						x1="80"
						y1={55 + sources.indexOf(relation.from) * 85}
						x2="340"
						y2={100 + targets.indexOf(relation.to) * 100}
						class:crossed={conflicts.forcedCrossed.includes(relation.id)}
					/>
				{/each}
				{#each sources as source, index (source)}
					<circle cx="80" cy={55 + index * 85} r="20" />
					<text x="80" y={60 + index * 85}>{source}</text>
				{/each}
				{#each targets as target, index (target)}
					<circle cx="340" cy={100 + index * 100} r="20" />
					<text x="340" y={105 + index * 100}>{target}</text>
				{/each}
			</svg>
			<p>Les traits rouges participent à une inversion d’ordre déduite pour ce passage.</p>
		</div>
		<div class="result">
			<h3>Contrat conditionnel</h3>
			{#if conflicts.status === 'unknown'}
				<p class="unknown">
					Croisements indéterminés pour cet autre passage. Les ports restent à décider après son
					routage.
				</p>
			{:else}
				<p>
					{conflicts.inversions.length} inversions · {conflicts.forcedCrossed.length} relations croisées
					· {conflicts.requiredSeparations.length} séparations de ports entrants.
				</p>
				<ul>
					{#each conflicts.inversions as pair (pair.firstRelationId + pair.secondRelationId)}
						<li>{pair.firstRelationId} × {pair.secondRelationId}</li>
					{/each}
				</ul>
				{#if faceD}
					<p>
						Sur d : {conflicts.requiredSeparations.filter(({ endpointId }) => endpointId === 'd')
							.length} paires séparées. Capacité minimale de la face :
						<strong
							>{faceD.alternatives.find(
								({ respectsRequiredSeparations }) => respectsRequiredSeparations,
							)?.metricDemand.minimumCrossSize}</strong
						> pour trois arrivées.
					</p>
				{/if}
			{/if}
		</div>
	</div>
</section>

<style>
	.conditional {
		line-height: 1.45;
	}
	header {
		display: flex;
		justify-content: space-between;
		gap: 2rem;
		align-items: end;
		margin-bottom: 1rem;
	}
	header > div:first-child {
		max-width: 650px;
	}
	header p {
		margin: 0;
		color: #526358;
	}
	.eyebrow {
		color: #5d7b69;
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0.13em;
		text-transform: uppercase;
	}
	h2,
	h3 {
		margin: 0.2rem 0 0.5rem;
	}
	.controls {
		display: flex;
		gap: 0.6rem;
		flex-wrap: wrap;
	}
	.controls label {
		display: grid;
		gap: 0.2rem;
		font-size: 0.78rem;
		font-weight: 600;
	}
	.controls select {
		height: 2.5rem;
		padding: 0.45rem;
		border: 1px solid #bdcdb5;
		border-radius: 6px;
		background: white;
		font: inherit;
	}
	.grid {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(300px, 0.8fr);
		gap: 1rem;
	}
	.graph,
	.result {
		border: 1px solid #d8ded2;
		border-radius: 10px;
		padding: 1rem;
		background: white;
	}
	svg {
		width: 100%;
		max-height: 420px;
		background: #fcfdf9;
	}
	line {
		stroke: #7a9c8a;
		stroke-width: 2.5;
	}
	line.crossed {
		stroke: #b44934;
		stroke-width: 3;
	}
	circle {
		fill: #eaf0e5;
		stroke: #456858;
		stroke-width: 2;
	}
	text {
		fill: #243e32;
		font-size: 16px;
		font-weight: 700;
		text-anchor: middle;
	}
	.graph > p,
	.result p {
		color: #526358;
	}
	.unknown {
		padding: 0.7rem;
		border-radius: 7px;
		background: #fff2df;
	}
	@media (max-width: 850px) {
		header,
		.grid {
			display: block;
		}
		.controls,
		.result {
			margin-top: 1rem;
		}
	}
</style>
