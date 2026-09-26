<script lang="ts">
	import {
		compareRankOrderCorpus,
		rankOrderComparisonCorpus,
		type RankOrderComparisonEntry,
	} from '../../solver-prototype/rank-order-comparison';
	import {
		compareRankOrderMutations,
		rankOrderMutationCorpus,
	} from '../../solver-prototype/rank-order-stability';

	const comparison = $derived(compareRankOrderCorpus(rankOrderComparisonCorpus()));
	const mutations = $derived(compareRankOrderMutations(rankOrderMutationCorpus()));

	function orderLabel(bands: readonly (readonly string[])[]): string {
		return bands.map((band) => band.join(' < ')).join(' · ');
	}

	function verdict(entry: RankOrderComparisonEntry): string {
		if (!entry.documentaryValid || !entry.enumeratedValid) return 'Oracle : invalide';
		if (entry.divergence) return 'Divergence';
		return 'Identique';
	}
</script>

<section class="rank-order" aria-label="Comparaison des ordres dans le rang">
	<header>
		<p class="eyebrow">Même domaine de rangs · proxy et géométrie validée</p>
		<h2>Ordre documentaire contre meilleur ordre énuméré</h2>
		<p>
			Le petit corpus énumère les inversions de relations adjacentes. La recherche de production
			compte aussi les liaisons longues projetées entre rangs, sans dimensions mesurées, puis classe
			les ordres par topologie et proximité documentaire. Elle n'admet que les layouts
			géométriquement valides dont les croisements réels (puis les ponts à égalité) ne dépassent pas
			ceux de l'ordre documentaire. Le minimum géométrique est calculé séparément sur les petits
			cas.
		</p>
	</header>
	<table>
		<thead>
			<tr>
				<th scope="col">Entrée</th>
				<th scope="col">Ordre documentaire</th>
				<th scope="col">Meilleur ordre énuméré</th>
				<th scope="col">Ordre retenu</th>
				<th scope="col">Kendall retenu / documentaire</th>
				<th scope="col">Proxy doc → énum</th>
				<th scope="col">Croisements réels doc → retenu (minimum)</th>
				<th scope="col">Ponts validés doc → retenu</th>
				<th scope="col">Recherche</th>
				<th scope="col">Candidats</th>
				<th scope="col">Verdict</th>
			</tr>
		</thead>
		<tbody>
			{#each comparison.entries as entry (entry.id)}
				<tr data-rank-order-entry={entry.id}>
					<th scope="row">{entry.label}</th>
					<td><code>{orderLabel(entry.documentary)}</code></td>
					<td><code>{orderLabel(entry.enumerated)}</code></td>
					<td><code>{orderLabel(entry.selectedOrder)}</code></td>
					<td>{entry.selectedKendall}</td>
					<td>{entry.documentaryCrossings} → {entry.enumeratedCrossings}</td>
					<td
						>{entry.documentaryRouteScore?.strictCrossings ?? 'rejeté'} → {entry.selectedRouteScore
							?.strictCrossings ?? 'rejeté'} ({entry.exhaustiveRouteScore?.strictCrossings ??
							'aucun'})</td
					>
					<td
						>{entry.documentaryRouteScore?.validatedBridges ?? 'rejeté'} → {entry.selectedRouteScore
							?.validatedBridges ?? 'rejeté'}</td
					>
					<td
						>{entry.witness.mode} · {entry.witness.stop} · {entry.witness.work
							.localCompletePipelines} pipelines locaux + {entry.witness.work
							.globalCompletePipelines} globaux · {entry.witness.rejected.length} rejets</td
					>
					<td>{entry.enumeratedCount}</td>
					<td>{verdict(entry)}</td>
				</tr>
			{/each}
		</tbody>
	</table>
</section>

<section class="rank-order" aria-label="Stabilité du layout après modification">
	<header>
		<h2>Stabilité après modification du document</h2>
		<p>
			Chaque mutation est aussi rendue en ordre documentaire (témoin). Les amplitudes brutes
			comptent les translations de vue ; les amplitudes relatives soustraient la translation médiane
			des centres communs avant de normaliser par leur ancienne diagonale. Les inversions ne
			comparent que les paires conservées au même rang avant et après. Les ports et tracés restent
			comparés en coordonnées absolues. Les composantes éditées et intactes sont détaillées avec
			leur témoin documentaire ; longueur et coudes comparent seulement les relations conservées.
		</p>
	</header>
	<table>
		<thead>
			<tr>
				<th scope="col">Modification</th>
				<th scope="col">Éléments ± · relations ±</th>
				<th scope="col">Croisements réels avant → après, choisi / documentaire</th>
				<th scope="col">Boîtes déplacées, choisi / documentaire</th>
				<th scope="col">Amplitude brute · relative, choisi / documentaire</th>
				<th scope="col">Boîtes refluées après translation médiane, choisi / documentaire</th>
				<th scope="col">Rangs modifiés</th>
				<th scope="col">Paires de rang inversées, choisi / documentaire</th>
				<th scope="col"
					>Composantes éditées / intactes : inversions · boîtes · ports · tracés, choisi /
					documentaire</th
				>
				<th scope="col">Ports · tracés modifiés</th>
				<th scope="col">Longueur commune avant → après</th>
				<th scope="col">Coudes communs avant → après</th>
				<th scope="col">Recherche avant → après</th>
			</tr>
		</thead>
		<tbody>
			{#each mutations as mutation (mutation.id)}
				<tr data-rank-order-mutation={mutation.id}>
					<th scope="row">{mutation.label}</th>
					<td
						>+{mutation.addedElements} / −{mutation.removedElements} · +{mutation.addedRelations} / −{mutation.removedRelations}</td
					>
					<td
						>{mutation.beforeCrossings ?? 'rejeté'} → {mutation.afterCrossings ?? 'rejeté'} /
						{mutation.beforeDocumentaryCrossings ?? 'rejeté'} → {mutation.afterDocumentaryCrossings ??
							'rejeté'}</td
					>
					<td
						>{mutation.movedElements} / {mutation.commonElements} · {mutation.documentary
							.movedElements} / {mutation.documentary.commonElements}</td
					>
					<td
						>{mutation.meanNormalizedMovement.toFixed(2)} · {mutation.meanRelativeNormalizedMovement.toFixed(
							2,
						)} / {mutation.documentary.meanNormalizedMovement.toFixed(2)} · {mutation.documentary.meanRelativeNormalizedMovement.toFixed(
							2,
						)}</td
					>
					<td
						>{mutation.relativeMovedElements} / {mutation.commonElements} · {mutation.documentary
							.relativeMovedElements} / {mutation.documentary.commonElements}</td
					>
					<td>{mutation.rankChanges} / {mutation.commonElements}</td>
					<td
						>{mutation.invertedRankPairs} / {mutation.commonRankPairs} · {mutation.documentary
							.invertedRankPairs} / {mutation.documentary.commonRankPairs}</td
					>
					<td>
						{#each mutation.components as component (component.ids.join(','))}
							<div>
								{#if component.touched}éditée{:else}intacte{/if}
								<code>{component.ids.join(', ')}</code>
								:
								{component.selected.invertedRankPairs} · {component.selected.movedElements} ·
								{component.selected.portChanges} · {component.selected.pathChanges} /
								{component.documentary.invertedRankPairs} · {component.documentary.movedElements} ·
								{component.documentary.portChanges} · {component.documentary.pathChanges}
							</div>
						{/each}
					</td>
					<td>{mutation.portChanges} · {mutation.pathChanges} / {mutation.commonRelations}</td>
					<td>{mutation.commonRouteLengthBefore} → {mutation.commonRouteLengthAfter} px</td>
					<td>{mutation.commonBendsBefore} → {mutation.commonBendsAfter}</td>
					<td
						>{mutation.beforeWitness.stop} → {mutation.afterWitness.stop} ({mutation.afterWitness
							.work.localCompletePipelines} locaux + {mutation.afterWitness.work
							.globalCompletePipelines} globaux) · limite de pipelines locaux {mutation.beforeWitness.components
							?.map((component) => component.pipelineLimit)
							.join('+') ?? '—'} → {mutation.afterWitness.components
							?.map((component) => component.pipelineLimit)
							.join('+') ?? '—'}</td
					>
				</tr>
			{/each}
		</tbody>
	</table>
</section>

<style>
	.rank-order {
		line-height: 1.45;
	}
	.eyebrow {
		margin-bottom: 0.2rem;
		font-size: 0.75rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--color-muted, #6b7280);
	}
	table {
		width: 100%;
		border-collapse: collapse;
		margin-top: 1rem;
		font-size: 0.9rem;
	}
	th,
	td {
		border-bottom: 1px solid var(--color-border, #d1d5db);
		padding: 0.4rem 0.6rem;
		text-align: left;
		vertical-align: top;
	}
	code {
		font-size: 0.85rem;
	}
</style>
