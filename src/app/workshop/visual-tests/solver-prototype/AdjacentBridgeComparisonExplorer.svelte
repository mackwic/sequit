<script lang="ts">
	import { VisualLayout } from '../../../../../tests/support/harnesses/visual-layout';
	import { LayoutDirection } from '../../../../lib/core/document/logic-document';
	import { IndependentAdjacentIssue } from '../../../../lib/core/layout/contract/independent-adjacent-resolution';
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
		let independentTitle = 'Contrat indépendant · détour retenu';
		if (comparison.independent.selectedIssue === IndependentAdjacentIssue.Bridge)
			independentTitle = 'Contrat indépendant · pont retenu';
		return [
			{
				id: 'dedicated',
				title: 'Moteur dédié · croisements pontés',
				policy: 'Valide géométriquement selon la politique du moteur dédié.',
				result: comparison.dedicated,
			},
			{
				id: 'independent',
				title: independentTitle,
				policy:
					'Compare le détour sans croisement au candidat compact du graphe de canaux ; chaque pont admis est validé par l’oracle commun.',
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
			deux dessins. Le moteur dédié valide ses croisements stricts. Le contrat indépendant compare
			son détour sans croisement à un candidat compact routé par le graphe de canaux partagé. Parmi
			les candidats validés, la croissance allouée prime ; à croissance allouée égale, le pont ne
			l’emporte que si l’oracle le valide et si le détour dépasse l’un des deux seuils. Sa recherche
			globale reste indéterminée.
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
		{#if comparison.independent.comparison}
			<section class="arbitration" aria-label="Coûts comparés par le contrat adjacent">
				<h3>Arbitrage du contrat : {comparison.independent.comparison.selected}</h3>
				<p>
					Tolérances de surcoût : aire +{comparison.independent.comparison.policy
						.detourAreaTolerance * 100} %, longueur +{comparison.independent.comparison.policy
						.detourLengthTolerance * 100} %.
				</p>
				<dl>
					<div>
						<dt>Croissance allouée du détour</dt>
						<dd>{comparison.independent.comparison.detourGrowth} px</dd>
					</div>
					<div>
						<dt>Croissance allouée du pont</dt>
						<dd>{comparison.independent.comparison.bridgeGrowth} px</dd>
					</div>
					<div>
						<dt>Aire du détour</dt>
						<dd>{comparison.independent.comparison.detour.area} px²</dd>
					</div>
					<div>
						<dt>Routes du détour</dt>
						<dd>{comparison.independent.comparison.detour.routeLength} px</dd>
					</div>
					<div>
						<dt>Aire du pont</dt>
						<dd>{comparison.independent.comparison.bridge.area} px²</dd>
					</div>
					<div>
						<dt>Routes du pont</dt>
						<dd>{comparison.independent.comparison.bridge.routeLength} px</dd>
					</div>
				</dl>
			</section>
		{/if}
		<div class="panels">
			{#each panels as panel (panel.id)}
				<article class="panel" data-adjacent-panel={panel.id}>
					<h3>{panel.title}</h3>
					{#if panel.id === 'independent'}
						<p class="decision" data-selected-issue={comparison.independent.selectedIssue}>
							Choix effectif : {comparison.independent.selectedIssue}
						</p>
					{/if}
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
							<dt>Extension géométrique des boîtes</dt>
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
		<article class="panel two-by-two" data-adjacent-panel="two-by-two">
			<h3>Contrat indépendant · 2+2, {comparison.twoByTwo.independent.selectedIssue} retenu</h3>
			<p class="policy">
				Document {comparison.twoByTwo.document.id} · mesures uniformes 96 × 400 px · candidat {comparison
					.twoByTwo.independent.candidateId}. À croissance allouée égale, les coûts réellement
				mesurés dépassent les tolérances du détour.
			</p>
			<figure data-comparison-figure="two-by-two">
				<LayoutPreview
					layout={new VisualLayout(
						comparison.twoByTwo.independent.layout,
						comparison.twoByTwo.ranks,
						LayoutDirection.TopToBottom,
					)}
					guides={false}
					frame={comparison.twoByTwo.frame}
				/>
			</figure>
			<dl aria-label="Coûts comparés du contrat 2+2">
				<div>
					<dt>Croissance allouée du détour</dt>
					<dd>{comparison.twoByTwo.independent.comparison.detourGrowth} px</dd>
				</div>
				<div>
					<dt>Croissance allouée du pont</dt>
					<dd>{comparison.twoByTwo.independent.comparison.bridgeGrowth} px</dd>
				</div>
				<div>
					<dt>Aire du détour</dt>
					<dd>{comparison.twoByTwo.independent.comparison.detour.area} px²</dd>
				</div>
				<div>
					<dt>Aire du pont</dt>
					<dd>{comparison.twoByTwo.independent.comparison.bridge.area} px²</dd>
				</div>
				<div>
					<dt>Routes du détour</dt>
					<dd>{comparison.twoByTwo.independent.comparison.detour.routeLength} px</dd>
				</div>
				<div>
					<dt>Routes du pont</dt>
					<dd>{comparison.twoByTwo.independent.comparison.bridge.routeLength} px</dd>
				</div>
			</dl>
			<dl>
				<div>
					<dt>Issues retenues</dt>
					<dd>{comparison.twoByTwo.independent.selectedIssue}</dd>
				</div>
				<div>
					<dt>Aire</dt>
					<dd>{comparison.twoByTwo.independent.metrics.area} px²</dd>
				</div>
				<div>
					<dt>Extension géométrique des boîtes</dt>
					<dd>{comparison.twoByTwo.independent.metrics.growth} px</dd>
				</div>
				<div>
					<dt>Longueur des routes</dt>
					<dd>{comparison.twoByTwo.independent.metrics.routeLength} px</dd>
				</div>
				<div>
					<dt>Croisements stricts</dt>
					<dd>{comparison.twoByTwo.independent.metrics.crossings}</dd>
				</div>
				<div>
					<dt>Ponts rendus</dt>
					<dd>{comparison.twoByTwo.independent.metrics.bridges}</dd>
				</div>
			</dl>
		</article>
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
	.arbitration {
		margin-block: 1rem;
		padding: 0.75rem;
		border: 1px solid #d8ded2;
		border-radius: 8px;
		background: #f5f7f2;
	}
	.arbitration dl {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
		gap: 0.5rem 1.5rem;
		margin: 0;
	}
	.arbitration dd {
		margin: 0.15rem 0 0;
		font-variant-numeric: tabular-nums;
		font-weight: 700;
	}
	.decision {
		font-weight: 700;
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
