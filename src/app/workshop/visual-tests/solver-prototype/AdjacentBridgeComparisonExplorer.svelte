<script lang="ts">
	import { VisualLayout } from '../../../../../tests/support/harnesses/visual-layout';
	import { LayoutDirection } from '../../../../lib/core/document/logic-document';
	import {
		type AdjacentEngineComparison,
		compareAdjacentBridgeAndDetour,
	} from '../../solver-prototype/adjacent-engine-comparison';
	import LayoutPreview from '../LayoutPreview.svelte';

	let comparison = $state<AdjacentEngineComparison | null>(null);
	let error = $state<string | null>(null);

	$effect(() => {
		let active = true;
		void compareAdjacentBridgeAndDetour()
			.then((value) => {
				if (active) comparison = value;
			})
			.catch((reason: unknown) => {
				if (active) error = String(reason);
			});
		return () => {
			active = false;
		};
	});

	const panels = $derived.by(() => {
		if (comparison === null) return [];
		return [
			{
				id: 'dedicated',
				title: 'Moteur dédié · croisements pontés',
				policy: 'Valide géométriquement selon la politique du moteur dédié.',
				result: comparison.dedicated,
			},
			{
				id: 'independent',
				title: 'Matérialiseur indépendant · détour sans croisement',
				policy:
					'Valide géométriquement selon la politique sans croisement strict ; statut global undetermined.',
				result: comparison.independent,
			},
		];
	});
</script>

<section class="comparison" aria-label="Comparaison du pont et du détour adjacents">
	<header>
		<p class="eyebrow">Même document · deux politiques géométriques</p>
		<h2>Un pont ou un détour pour le corridor adjacent 3+1</h2>
		<p>
			Les relations a→d, b→d, c→d et a→e partagent les mêmes rangs et les mêmes mesures dans les
			deux dessins. Le moteur dédié accepte et ponte ses croisements stricts. Le matérialiseur
			indépendant inverse l’ordre transversal de d et e et choisit des routes sans croisement ; sa
			recherche globale reste indéterminée.
		</p>
	</header>
	{#if error}
		<p role="alert">{error}</p>
	{:else if comparison}
		<p class="provenance" role="status">
			Document {comparison.document.id} · rangs a,b,c = {comparison.ranks.get('a')}, d,e =
			{comparison.ranks.get('d')} · cadre commun {comparison.frame.width} ×
			{comparison.frame.height} px · candidat indépendant {comparison.independent.candidateId} · globalStatus:
			{comparison.independent.globalStatus}
		</p>
		<div class="panels">
			{#each panels as panel (panel.id)}
				<article class="panel" data-adjacent-panel={panel.id}>
					<h3>{panel.title}</h3>
					<p class="policy">{panel.policy}</p>
					<p class="target-order">Ordre cible : {panel.result.targetOrder}</p>
					<figure data-comparison-figure={panel.id}>
						<LayoutPreview
							layout={new VisualLayout(
								panel.result.layout,
								comparison.ranks,
								LayoutDirection.TopToBottom,
							)}
							guides={false}
							frame={comparison.frame}
						/>
					</figure>
					<dl>
						<div>
							<dt>Aire</dt>
							<dd>{panel.result.metrics.area} px²</dd>
						</div>
						<div>
							<dt>Croissance</dt>
							<dd>{panel.result.metrics.growth} px</dd>
						</div>
						<div>
							<dt>Longueur des routes</dt>
							<dd>{panel.result.metrics.routeLength} px</dd>
						</div>
						<div>
							<dt>Coudes</dt>
							<dd>{panel.result.metrics.bends}</dd>
						</div>
						<div>
							<dt>Croisements stricts</dt>
							<dd>{panel.result.metrics.crossings}</dd>
						</div>
						<div>
							<dt>Ponts rendus</dt>
							<dd>{panel.result.metrics.bridges}</dd>
						</div>
					</dl>
				</article>
			{/each}
		</div>
	{:else}
		<p role="status">Calcul des deux géométries adjacentes…</p>
	{/if}
</section>

<style>
	.comparison {
		line-height: 1.45;
	}
	.eyebrow {
		margin-bottom: 0.2rem;
		color: #5d7b69;
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0.13em;
		text-transform: uppercase;
	}
	h2,
	h3 {
		margin: 0.25rem 0 0.6rem;
	}
	header > p:last-child {
		max-width: 860px;
		color: #526358;
	}
	.provenance {
		padding: 0.7rem 1rem;
		border-radius: 8px;
		background: #e8f3e9;
		color: #285448;
	}
	.panels {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 1rem;
	}
	.panel {
		min-width: 0;
		padding: 1rem;
		border: 1px solid #d8ded2;
		border-radius: 10px;
		background: white;
	}
	.policy {
		min-height: 3rem;
		color: #526358;
	}
	figure {
		margin: 0;
		background: #fcfdf9;
	}
	figure :global(svg) {
		display: block;
		width: 100%;
		height: 430px;
	}
	dl {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0.45rem;
		margin: 1rem 0 0;
	}
	dl > div {
		padding: 0.5rem;
		border-radius: 6px;
		background: #f5f7f2;
	}
	dt {
		font-size: 0.72rem;
		color: #526358;
	}
	dd {
		margin: 0.15rem 0 0;
		font-weight: 700;
	}
	@media (max-width: 880px) {
		.panels {
			grid-template-columns: 1fr;
		}
	}
</style>
