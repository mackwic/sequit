<script lang="ts">
	import {
		compareRankOrderCorpus,
		rankOrderComparisonCorpus,
		type RankOrderComparisonEntry,
	} from '../../solver-prototype/rank-order-comparison';

	const comparison = $derived(compareRankOrderCorpus(rankOrderComparisonCorpus()));

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
			L'énumération abstraite compte les inversions de relations, sans géométrie. La recherche en
			production ne retient que des layouts entièrement matérialisés et validés : croisements
			stricts, ponts, puis proximité à l'ordre documentaire. Le minimum géométrique est calculé
			séparément sur les petits cas.
		</p>
	</header>
	<table>
		<thead>
			<tr>
				<th scope="col">Entrée</th>
				<th scope="col">Ordre documentaire</th>
				<th scope="col">Meilleur ordre énuméré</th>
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
						>{entry.witness.mode} · {entry.witness.stop} · {entry.witness.evaluated} pipelines · {entry
							.witness.rejected.length} rejets</td
					>
					<td>{entry.enumeratedCount}</td>
					<td>{verdict(entry)}</td>
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
