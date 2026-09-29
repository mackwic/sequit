<script lang="ts">
	import { resolve } from '$app/paths';

	import { threeIncidenceFaceCapacity } from '../../solver-prototype/face-capacity';
	import {
		symbolicBlockingGroupFixture,
		symbolicFreeGapFixture,
	} from '../../solver-prototype/symbolic-lane-fixtures';
	import {
		type CandidateTrace,
		solveSymbolicLaneSlice,
	} from '../../solver-prototype/symbolic-lane-slice';
	import LayoutPreview from '../LayoutPreview.svelte';
	import ComposedExplorer from './ComposedExplorer.svelte';
	import ConditionalConflictsExplorer from './ConditionalConflictsExplorer.svelte';
	import { type FoldedGroupWitness, runFoldedGroupWitness } from './folded-group';
	import FoldedRoutePreview from './FoldedRoutePreview.svelte';
	import GridCellAllocationExplorer from './GridCellAllocationExplorer.svelte';
	import GridCellExplorer from './GridCellExplorer.svelte';
	import JointK32Explorer from './JointK32Explorer.svelte';
	import RankOrderComparisonExplorer from './RankOrderComparisonExplorer.svelte';
	import RegionContactExplorer from './RegionContactExplorer.svelte';
	import RegionLaneLeafExplorer from './RegionLaneLeafExplorer.svelte';
	import SharedLanePassageExplorer from './SharedLanePassageExplorer.svelte';

	type WitnessId =
		| 'free-gap'
		| 'blocking-group'
		| 'face-capacity'
		| 'conditional-conflicts'
		| 'joint-k32'
		| 'rank-order-comparison'
		| 'composed'
		| 'folded-group'
		| 'grid-cells'
		| 'grid-crossing-allocation'
		| 'region-contact'
		| 'region-lane-leaf'
		| 'shared-lane-passage';
	type Orientation = 'vertical' | 'horizontal';

	let witnessId = $state<WitnessId>('free-gap');
	let orientation = $state<Orientation>('vertical');
	let relationDirection = $state<'forward' | 'reverse'>('forward');
	let branchBudget = $state(8);
	let clearance = $state(16);
	let inspectedId = $state('');
	let showAlternatives = $state(true);
	let requireDistinctPorts = $state(true);
	let portChoiceIndex = $state(4);
	let folded = $state<FoldedGroupWitness | null>(null);
	let foldedError = $state<string | null>(null);

	const fixture = $derived.by(() => {
		let graph = symbolicFreeGapFixture(orientation);
		if (witnessId === 'blocking-group') graph = symbolicBlockingGroupFixture(orientation);
		if (relationDirection === 'forward') return graph;
		return {
			...graph,
			relation: { ...graph.relation, from: graph.relation.to, to: graph.relation.from },
		};
	});
	const solution = $derived(
		solveSymbolicLaneSlice(fixture, {
			laneGap: 40,
			rankGap: 32,
			railSpacing: 24,
			budget: Math.max(1, Math.floor(branchBudget || 1)),
			clearance: Math.max(0, clearance || 0),
		}),
	);
	const selectedTrace = $derived(solution.candidates.find(({ id }) => id === solution.selectedId));
	const inspectedTrace = $derived(
		solution.candidates.find(({ id }) => id === inspectedId) ??
			selectedTrace ??
			solution.candidates[0],
	);
	const shownGeometry = $derived(inspectedTrace?.geometry ?? selectedTrace?.geometry);
	const requiredSeparations = $derived(separationRules(requireDistinctPorts));
	const faceContract = $derived(
		threeIncidenceFaceCapacity({
			endpointId: 'd',
			role: 'incoming',
			incidences: [
				{ relationId: 'a-d', oppositeEndpointId: 'a' },
				{ relationId: 'b-d', oppositeEndpointId: 'b' },
				{ relationId: 'c-d', oppositeEndpointId: 'c' },
			],
			intrinsicCrossSize: 80,
			inset: 24,
			spacing: 48,
			requiredSeparations,
		}),
	);
	const portChoice = $derived(
		faceContract.alternatives[portChoiceIndex] ?? faceContract.alternatives[4],
	);

	$effect(() => {
		if (witnessId !== 'folded-group') return;
		let active = true;
		void runFoldedGroupWitness()
			.then((result) => {
				if (!active) return;
				folded = result;
				foldedError = null;
			})
			.catch((error: unknown) => {
				if (!active) return;
				foldedError = String(error);
			});
		return () => {
			active = false;
		};
	});

	function points(path: readonly { x: number; y: number }[]): string {
		return path.map(({ x, y }) => `${x},${y}`).join(' ');
	}

	function portPositions(count: number, size: number): number[] {
		return Array.from(
			{ length: count },
			(_, index) => 24 + (size - (count - 1) * 48) / 2 + index * 48,
		);
	}

	function metric(value: number): string {
		if (Number.isInteger(value)) return String(value);
		return value.toFixed(1);
	}

	function separationRules(distinct: boolean) {
		if (!distinct) return [];
		return [
			{ firstRelationId: 'a-d', secondRelationId: 'b-d' },
			{ firstRelationId: 'a-d', secondRelationId: 'c-d' },
			{ firstRelationId: 'b-d', secondRelationId: 'c-d' },
		];
	}

	function sharesGeometry(
		left: NonNullable<CandidateTrace['geometry']>,
		right: NonNullable<CandidateTrace['geometry']>,
	): boolean {
		const sameBounds = (
			a: { x: number; y: number; width: number; height: number },
			b: { x: number; y: number; width: number; height: number },
		) => a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
		return (
			left.lanes.length === right.lanes.length &&
			left.boxes.length === right.boxes.length &&
			left.lanes.every((lane, index) => {
				const other = right.lanes[index];
				if (other === undefined) return false;
				return lane.id === other.id && sameBounds(lane.bounds, other.bounds);
			}) &&
			left.boxes.every((box, index) => {
				const other = right.boxes[index];
				if (other === undefined) return false;
				return box.id === other.id && sameBounds(box.bounds, other.bounds);
			})
		);
	}

	function viewBoxFor(geometry: NonNullable<CandidateTrace['geometry']>): string {
		const rectangles = [...geometry.lanes, ...geometry.boxes].map(({ bounds }) => bounds);
		const x = [...rectangles.map(({ x }) => x), ...geometry.path.map(({ x }) => x)];
		const y = [...rectangles.map(({ y }) => y), ...geometry.path.map(({ y }) => y)];
		const right = [
			...rectangles.map(({ x, width }) => x + width),
			...geometry.path.map(({ x }) => x),
		];
		const bottom = [
			...rectangles.map(({ y, height }) => y + height),
			...geometry.path.map(({ y }) => y),
		];
		const margin = 36;
		const left = Math.min(...x) - margin;
		const top = Math.min(...y) - margin;
		return `${left} ${top} ${Math.max(...right) - left + margin} ${Math.max(...bottom) - top + margin}`;
	}

	function statusLabel(status: CandidateTrace['status']): string {
		switch (status) {
			case 'selected':
				return 'Retenue';
			case 'feasible':
				return 'Admissible';
			case 'rejected':
				return 'Rejetée';
			case 'not-explored':
				return 'Non explorée';
			default:
				return 'Statut inconnu';
		}
	}

	function kindLabel(kind: CandidateTrace['kind']): string {
		switch (kind) {
			case 'existing-slot':
				return 'Passage existant';
			case 'insert-rank':
				return 'Rang visuel vide';
			case 'exterior':
				return 'Passage extérieur';
			default:
				return 'Branche inconnue';
		}
	}

	function inspectedLabel(trace: CandidateTrace | undefined): string {
		if (trace === undefined) return 'Aucun candidat';
		return kindLabel(trace.kind);
	}
</script>

<main class="explorer">
	<div class="intro">
		<p class="eyebrow">Prototype des IR de layout</p>
		<h1>Explorer les contrats et les passages</h1>
		<p>
			Les témoins partent de rangs visuels, de tailles intrinsèques et de relations sans
			coordonnées. Le contrat propose des passages, des ports et des demandes de dégagement ; la
			recherche matérialise puis vérifie les candidats. Le groupe replié éprouve séparément la
			provenance des relations du document. Ce prototype d'atelier ne remplace pas le moteur actuel.
		</p>
		<p>
			<a href={resolve('/atelier/tests-visuels/[[scenario]]', { scenario: 'three-incoming-ports' })}
				>Comparer au scénario actuel des trois ports entrants →</a
			>
		</p>
	</div>

	<div class="witness-tabs" role="group" aria-label="Témoin à explorer">
		<button
			type="button"
			class:active={witnessId === 'free-gap'}
			aria-pressed={witnessId === 'free-gap'}
			onclick={() => (witnessId = 'free-gap')}>Passage libre</button
		>
		<button
			type="button"
			class:active={witnessId === 'blocking-group'}
			aria-pressed={witnessId === 'blocking-group'}
			onclick={() => (witnessId = 'blocking-group')}>Groupe bloquant</button
		>
		<button
			type="button"
			class:active={witnessId === 'face-capacity'}
			aria-pressed={witnessId === 'face-capacity'}
			onclick={() => (witnessId = 'face-capacity')}>Trois ports</button
		>
		<button
			type="button"
			class:active={witnessId === 'composed'}
			aria-pressed={witnessId === 'composed'}
			onclick={() => (witnessId = 'composed')}>Ports × passages</button
		>
		<button
			type="button"
			class:active={witnessId === 'conditional-conflicts'}
			aria-pressed={witnessId === 'conditional-conflicts'}
			onclick={() => (witnessId = 'conditional-conflicts')}>Conflits conditionnels</button
		>
		<button
			type="button"
			class:active={witnessId === 'joint-k32'}
			aria-pressed={witnessId === 'joint-k32'}
			onclick={() => (witnessId = 'joint-k32')}>Ordres × conflits × ports</button
		>
		<button
			type="button"
			class:active={witnessId === 'rank-order-comparison'}
			aria-pressed={witnessId === 'rank-order-comparison'}
			onclick={() => (witnessId = 'rank-order-comparison')}>Ordres dans le rang</button
		>
		<button
			type="button"
			class:active={witnessId === 'folded-group'}
			aria-pressed={witnessId === 'folded-group'}
			onclick={() => (witnessId = 'folded-group')}>G replié</button
		>
		<button
			type="button"
			class:active={witnessId === 'grid-cells'}
			aria-pressed={witnessId === 'grid-cells'}
			onclick={() => (witnessId = 'grid-cells')}>Grille 2×2</button
		>
		<button
			type="button"
			class:active={witnessId === 'grid-crossing-allocation'}
			aria-pressed={witnessId === 'grid-crossing-allocation'}
			onclick={() => (witnessId = 'grid-crossing-allocation')}>Allocation de grille</button
		>
		<button
			type="button"
			class:active={witnessId === 'region-lane-leaf'}
			aria-pressed={witnessId === 'region-lane-leaf'}
			onclick={() => (witnessId = 'region-lane-leaf')}>Lanes dans région</button
		>
		<button
			type="button"
			class:active={witnessId === 'region-contact'}
			aria-pressed={witnessId === 'region-contact'}
			onclick={() => (witnessId = 'region-contact')}>Contacts de régions</button
		>
		<button
			type="button"
			class:active={witnessId === 'shared-lane-passage'}
			aria-pressed={witnessId === 'shared-lane-passage'}
			onclick={() => (witnessId = 'shared-lane-passage')}>Passages S | SD | C</button
		>
	</div>

	{#if witnessId === 'rank-order-comparison'}
		<RankOrderComparisonExplorer />
	{:else if witnessId === 'shared-lane-passage'}
		<SharedLanePassageExplorer />
	{:else if witnessId === 'region-contact'}
		<RegionContactExplorer />
	{:else if witnessId === 'region-lane-leaf'}
		<RegionLaneLeafExplorer />
	{:else if witnessId === 'grid-crossing-allocation'}
		<GridCellAllocationExplorer />
	{:else if witnessId === 'grid-cells'}
		<GridCellExplorer />
	{:else if witnessId === 'composed'}
		<ComposedExplorer />
	{:else if witnessId === 'conditional-conflicts'}
		<ConditionalConflictsExplorer />
	{:else if witnessId === 'joint-k32'}
		<JointK32Explorer />
	{:else if witnessId === 'face-capacity'}
		<section class="face-witness" aria-label="Contrat de capacité de face">
			<h2>Trois arrivées sur D</h2>
			<p>
				Cette tranche énumère les partages possibles entre trois incidences. L'obligation de séparer
				leurs ports est fournie comme contrainte : ce témoin ne la déduit pas encore du routage. Le <a
					href={resolve('/atelier/tests-visuels/[[scenario]]', {
						scenario: 'three-incoming-ports',
					})}>scénario du moteur actuel</a
				> montre trois arrivées distinctes dans le pipeline réel.
			</p>
			<label class="face-toggle">
				<input type="checkbox" bind:checked={requireDistinctPorts} />
				Exiger trois ports séparés
			</label>
			<div class="face-grid">
				<div class="face-options">
					<h3>Alternatives du contrat</h3>
					{#each faceContract.alternatives as alternative, index (index)}
						<button
							type="button"
							class:active={portChoiceIndex === index}
							aria-pressed={portChoiceIndex === index}
							onclick={() => (portChoiceIndex = index)}
						>
							<strong>{alternative.portGroups.map((group) => group.join('+')).join(' | ')}</strong>
							<span
								>{alternative.portGroups.length} port(s) · face ≥ {alternative.metricDemand
									.minimumCrossSize} · croissance {alternative.metricDemand.growth}</span
							>
							<small class:rejected={!alternative.respectsRequiredSeparations}>
								{#if alternative.respectsRequiredSeparations}
									Respecte les séparations fournies
								{:else}
									Partage interdit par une séparation fournie
								{/if}
							</small>
						</button>
					{/each}
				</div>
				{#if portChoice}
					<div class="face-preview">
						<h3>Dimension demandée</h3>
						<svg
							role="img"
							aria-label={`${portChoice.portGroups.length} ports sur une face de ${portChoice.metricDemand.minimumCrossSize}`}
							viewBox="0 0 300 240"
						>
							<rect
								class="port-box"
								x="65"
								y="24"
								width="150"
								height={portChoice.metricDemand.minimumCrossSize}
								rx="7"
							/>
							{#each portPositions(portChoice.portGroups.length, portChoice.metricDemand.minimumCrossSize) as position, index (index)}
								<circle class="port-point" cx="215" cy={position} r="6" />
								<text x="230" y={position + 4}>{portChoice.portGroups[index]?.join('+')}</text>
							{/each}
							<text x="76" y="216"
								>80 intrinsèque → {portChoice.metricDemand.minimumCrossSize} alloué</text
							>
						</svg>
						<p>Minimum = max(80, 2 × 24 + ({portChoice.portGroups.length} − 1) × 48).</p>
					</div>
				{/if}
			</div>
		</section>
	{:else if witnessId === 'folded-group'}
		<section class="folded" aria-label="Témoin du groupe replié">
			<h2>Groupe replié : source, projection et prototype géométrique</h2>
			<p>
				Une politique bornée du pipeline réel garde maintenant G replié pour la source B → x → A. Le
				prototype ci-dessous isole la provenance des deux attaches latérales et vérifie leurs routes
				; la composition générale des groupes reste ouverte.
			</p>
			<FoldedRoutePreview />
			{#if foldedError}
				<p role="alert" class="error">{foldedError}</p>
			{:else if folded}
				<div class="folded-grid">
					<div class="diagram real-pipeline">
						<h3>Layout déplié · pipeline réel</h3>
						<LayoutPreview layout={folded.expanded} guides={false} />
					</div>
					<div class="folded-details">
						<h3>Graphe normalisé, sans coordonnées</h3>
						<ul>
							{#each folded.normalized.relations as relation (relation.id)}
								<li>
									<code>{relation.from.endpointId} → {relation.to.endpointId}</code>
									<small>
										Propriétaires visibles : {relation.from.visibleOwnerId} → {relation.to
											.visibleOwnerId}
									</small>
								</li>
							{/each}
						</ul>
						<h3>Projection naïve des relations</h3>
						<ul>
							{#each folded.projectedRelations as relation (relation.id)}
								<li>
									<code>{relation.from} → {relation.to}</code>
									<small>Origine : {relation.sourceRelationIds.join(', ')}</small>
								</li>
							{/each}
						</ul>
						<p>Éléments masqués : {folded.hiddenEndpointIds.join(', ') || 'aucun'}</p>
						<p class="diagnostic">{folded.diagnostic}</p>
					</div>
				</div>
			{:else}
				<p role="status">Calcul du témoin…</p>
			{/if}
		</section>
	{:else}
		<section class="configuration" aria-label="Paramètres du prototype">
			<div>
				<h2>{fixture.title}</h2>
				{#if witnessId === 'blocking-group'}
					<p>
						Le groupe de SD couvre les rangs proposés. Les passages qui le coupent sont rejetés ; le
						passage extérieur reste à explorer.
					</p>
				{:else}
					<p>
						Le groupe de SD occupe un seul rang. Comparez le passage entre rangs aux autres branches
						et aux dimensions qu'elles demandent.
					</p>
				{/if}
			</div>
			<div class="controls">
				<label>
					Orientation des lanes
					<select bind:value={orientation}>
						<option value="vertical">Verticales</option>
						<option value="horizontal">Horizontales</option>
					</select>
				</label>
				<label>
					Sens de la relation
					<select bind:value={relationDirection}>
						<option value="forward">S → C</option>
						<option value="reverse">C → S</option>
					</select>
				</label>
				<label>
					Branches explorées au maximum
					<input type="number" min="1" max="12" step="1" bind:value={branchBudget} />
				</label>
				<label>
					Dégagement minimal · px
					<input type="number" min="0" max="80" step="1" bind:value={clearance} />
				</label>
			</div>
		</section>

		<div class="solver-grid">
			<section class="diagram" aria-label="Dessin du candidat inspecté">
				<div class="panel-head">
					<div>
						<p class="eyebrow">Dessin calculé</p>
						<h2>{inspectedLabel(inspectedTrace)}</h2>
					</div>
					{#if inspectedTrace}<span class:rejected={inspectedTrace.status === 'rejected'}
							>{statusLabel(inspectedTrace.status)}</span
						>{/if}
				</div>
				{#if shownGeometry}
					<svg
						role="img"
						aria-label={`Lanes, obstacles et trajet du candidat ${inspectedTrace?.id ?? ''}`}
						viewBox={viewBoxFor(shownGeometry)}
					>
						{#each shownGeometry.lanes as lane (lane.id)}
							<g>
								<rect class="lane" {...lane.bounds} />
								<text class="lane-label" x={lane.bounds.x + 10} y={lane.bounds.y - 9}
									>{lane.label}</text
								>
							</g>
						{/each}
						{#if showAlternatives}
							{#each solution.candidates as candidate (candidate.id)}
								{#if candidate.geometry && candidate.id !== inspectedTrace?.id && sharesGeometry(candidate.geometry, shownGeometry)}
									<polyline
										class="alternative-path"
										class:rejected-path={candidate.status === 'rejected'}
										points={points(candidate.geometry.path)}
									/>
								{/if}
							{/each}
						{/if}
						{#each shownGeometry.boxes as box (box.id)}
							<g>
								<rect class:group={box.kind === 'group'} class="box" {...box.bounds} rx="5" />
								<text class="box-label" x={box.bounds.x + 8} y={box.bounds.y + 19}>{box.label}</text
								>
							</g>
						{/each}
						{#if inspectedTrace?.geometry}
							<polyline
								class="inspected-path"
								class:rejected-path={inspectedTrace.status === 'rejected'}
								points={points(inspectedTrace.geometry.path)}
							/>
						{/if}
					</svg>
				{:else}
					<p class="empty">Cette branche n'a pas de géométrie matérialisée.</p>
				{/if}
				<label class="overlay-toggle">
					<input type="checkbox" bind:checked={showAlternatives} />
					Superposer les trajets dont les boîtes restent identiques
				</label>
				<p class="overlay-note">
					Une branche qui agrandit le dessin ou déplace des boîtes se consulte séparément dans la
					trace.
				</p>
				<p class="legend">
					<span class="legend-line chosen"></span> Candidat inspecté
					<span class="legend-line other"></span> Autre branche
					<span class="legend-line rejected-line"></span> Branche rejetée
				</p>
			</section>

			<section class="trace" aria-label="Trace des branches du solveur">
				<div class="panel-head">
					<div>
						<p class="eyebrow">Recherche bornée</p>
						<h2>Branches et raisons</h2>
					</div>
				</div>
				<p class="summary" role="status">
					{solution.explored} branche(s) explorée(s) sur {solution.budget} autorisée(s).
					{#if solution.truncated}
						Recherche incomplète : les branches restantes peuvent changer le choix.
					{:else if solution.outcome === 'infeasible'}
						Aucune solution admissible parmi toutes les branches du contrat.
					{/if}
				</p>
				<div class="branch-list">
					{#each solution.candidates as candidate (candidate.id)}
						<button
							type="button"
							class:active={candidate.id === inspectedTrace?.id}
							aria-pressed={candidate.id === inspectedTrace?.id}
							onclick={() => (inspectedId = candidate.id)}
						>
							<span class="branch-title">
								<strong>{kindLabel(candidate.kind)}</strong>
								<small class:rejected={candidate.status === 'rejected'}
									>{statusLabel(candidate.status)}</small
								>
							</span>
							<code>{candidate.id}</code>
							{#if candidate.reason}<span class="reason">{candidate.reason}</span>{/if}
							<span class="metrics">
								Demandes : {candidate.demands
									.map(({ kind, minimum }) => `${kind} ≥ ${metric(minimum)}`)
									.join(' · ') || 'aucune'}
								{#if candidate.geometry}
									· écartement des lanes alloué : {metric(candidate.geometry.allocatedLaneGap)}
									· écartement des rangs alloué : {metric(candidate.geometry.allocatedRankGap)}
								{/if}
							</span>
							{#if candidate.score}<span class="score"
									>Score (localité du passage, coudes, longueur, étendue) : [{candidate.score.join(
										', ',
									)}]</span
								>{/if}
						</button>
					{/each}
				</div>
			</section>
		</div>
		<section class="ir-view" aria-label="Entrée et contrat symboliques">
			<h2>Avant les coordonnées</h2>
			<p>
				Les boîtes ont un propriétaire, un rang préféré et une taille intrinsèque. Les passages
				ci-dessous sont énumérés avant le dessin ; l'ordre des éléments est fixé dans cette tranche.
			</p>
			<div class="ir-grid">
				<details>
					<summary>Graphe de layout · {solution.graph.elements.length} éléments</summary>
					<pre>{JSON.stringify(solution.graph, null, 2)}</pre>
				</details>
				<details>
					<summary>Rangs et ordres · {solution.layering.rankAlternatives.length} options</summary>
					<pre>{JSON.stringify(solution.layering, null, 2)}</pre>
				</details>
				<details>
					<summary>Contrat · {solution.contract.alternatives.length} passages</summary>
					<pre>{JSON.stringify(solution.contract, null, 2)}</pre>
				</details>
			</div>
		</section>
	{/if}
</main>

<style>
	.explorer {
		line-height: 1.5;
	}
	.intro {
		max-width: 850px;
		margin: 2rem 0;
	}
	.eyebrow {
		margin: 0;
		color: #5d7b69;
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0.13em;
		text-transform: uppercase;
	}
	h1 {
		margin: 0.3rem 0 0.7rem;
		font-size: clamp(2.2rem, 5vw, 3.7rem);
		line-height: 1.12;
		letter-spacing: -0.05em;
	}
	.intro > p:last-child,
	.configuration p,
	.folded > p {
		color: #526358;
	}
	.intro a {
		color: #2764a5;
		font-weight: 600;
		text-underline-offset: 4px;
	}
	.witness-tabs {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin: 1.5rem 0;
	}
	.witness-tabs button {
		border: 1px solid #bdcdb5;
		border-radius: 999px;
		padding: 0.55rem 1rem;
		background: white;
		color: #285448;
		font: inherit;
		font-weight: 600;
		cursor: pointer;
	}
	.witness-tabs button.active {
		border-color: #285448;
		background: #285448;
		color: white;
	}
	.configuration {
		display: flex;
		justify-content: space-between;
		align-items: end;
		gap: 2rem;
		margin-bottom: 1.2rem;
	}
	.configuration h2,
	.folded h2 {
		margin: 0 0 0.3rem;
		font-size: 1.35rem;
	}
	.configuration p {
		margin: 0;
		max-width: 640px;
	}
	.controls {
		display: flex;
		flex-wrap: wrap;
		gap: 0.65rem;
	}
	.controls label {
		display: grid;
		gap: 0.25rem;
		font-size: 0.78rem;
		font-weight: 600;
	}
	.controls :is(select, input) {
		box-sizing: border-box;
		min-width: 8rem;
		height: 2.5rem;
		padding: 0.45rem 0.6rem;
		border: 1px solid #bdcdb5;
		border-radius: 6px;
		background: white;
		color: inherit;
		font: inherit;
	}
	.controls input {
		width: 8rem;
	}
	.solver-grid,
	.folded-grid {
		display: grid;
		grid-template-columns: minmax(0, 1.4fr) minmax(310px, 1fr);
		gap: 1.2rem;
	}
	.diagram,
	.trace,
	.folded-details {
		min-width: 0;
		border: 1px solid #d8ded2;
		border-radius: 12px;
		background: white;
		overflow: hidden;
		box-shadow: 0 6px 30px #33472c08;
	}
	.panel-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.7rem;
		padding: 1rem 1.2rem;
		border-bottom: 1px solid #e0e7dc;
	}
	.panel-head h2 {
		margin: 0.1rem 0 0;
		font-size: 1.15rem;
	}
	.panel-head > span,
	.branch-title small {
		border-radius: 999px;
		padding: 0.2rem 0.55rem;
		background: #e8f3e9;
		color: #285448;
		font-size: 0.72rem;
		font-weight: 700;
		white-space: nowrap;
	}
	.panel-head > span.rejected,
	.branch-title small.rejected {
		background: #fcebe8;
		color: #9a392a;
	}
	svg {
		display: block;
		box-sizing: border-box;
		width: 100%;
		height: min(64vw, 610px);
		min-height: 330px;
		padding: 1rem;
		background-color: #fcfdf9;
		background-image: radial-gradient(#d0d9c9 1px, transparent 1px);
		background-size: 16px 16px;
	}
	.lane {
		fill: #eaf0e5;
		stroke: #9bb29e;
		stroke-width: 1.5;
	}
	.lane-label {
		fill: #426552;
		font-size: 12px;
		font-weight: 700;
	}
	.box {
		fill: #f8fbf3;
		stroke: #456858;
		stroke-width: 2;
	}
	.box.group {
		fill: #f3e8d4;
		stroke: #9b6c30;
	}
	.box-label {
		fill: #243e32;
		font-size: 11px;
		font-weight: 650;
	}
	.alternative-path,
	.inspected-path {
		fill: none;
		stroke: #2764a5;
		stroke-linecap: round;
		stroke-linejoin: round;
		stroke-width: 3;
	}
	.alternative-path {
		stroke-opacity: 0.45;
		stroke-width: 2;
		stroke-dasharray: 7 5;
	}
	.rejected-path {
		stroke: #b44934;
		stroke-dasharray: 6 5;
	}
	.overlay-toggle {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.5rem 1.2rem 0;
		font-size: 0.83rem;
	}
	.overlay-note {
		margin: 0;
		padding: 0 1.2rem;
		color: #617267;
		font-size: 0.75rem;
	}
	.legend {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem 0.65rem;
		padding: 0 1.2rem 1rem;
		font-size: 0.75rem;
		color: #526358;
	}
	.legend-line {
		display: inline-block;
		width: 1.3rem;
		border-top: 3px solid #2764a5;
	}
	.legend-line.other {
		opacity: 0.5;
		border-top-style: dashed;
	}
	.legend-line.rejected-line {
		border-color: #b44934;
		border-top-style: dashed;
	}
	.summary,
	.empty {
		padding: 0.1rem 1.2rem;
		color: #526358;
		font-size: 0.85rem;
	}
	.branch-list {
		display: grid;
		gap: 0.5rem;
		padding: 0 0.8rem 1rem;
	}
	.branch-list button {
		display: grid;
		gap: 0.3rem;
		width: 100%;
		padding: 0.75rem;
		border: 1px solid #d8ded2;
		border-radius: 8px;
		background: white;
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
	}
	.branch-list button.active {
		border-color: #2764a5;
		box-shadow: 0 0 0 2px #2764a524;
	}
	.branch-list button:hover {
		background: #f7faf4;
	}
	.branch-title {
		display: flex;
		justify-content: space-between;
		gap: 0.5rem;
	}
	.branch-list code,
	.metrics,
	.score,
	.reason {
		font-size: 0.76rem;
	}
	.branch-list code,
	.metrics,
	.score {
		color: #617267;
	}
	.reason {
		color: #7b4935;
	}
	.folded {
		margin-top: 1rem;
	}
	.folded-grid {
		margin-top: 1.2rem;
	}
	.folded h3,
	.folded-details h3 {
		margin: 0;
		padding: 1rem 1.2rem;
		font-size: 1rem;
	}
	.folded-details {
		padding: 0 1.2rem 1rem;
	}
	.folded-details h3 {
		padding-left: 0;
	}
	.folded-details ul {
		padding-left: 1.2rem;
	}
	.folded-details li {
		margin-bottom: 0.7rem;
	}
	.folded-details small {
		display: block;
		color: #617267;
	}
	.diagnostic,
	.error {
		border-left: 3px solid #b44934;
		padding: 0.6rem 0.8rem;
		background: #fff4ef;
	}
	.real-pipeline :global(.layout-preview) {
		padding: 1rem;
		background: #fcfdf9;
	}
	.real-pipeline :global(.layout-preview svg) {
		display: block;
		width: 100%;
		max-height: 610px;
		margin: auto;
	}
	.ir-view {
		margin-top: 1.5rem;
		padding: 1rem 1.2rem 1.2rem;
		border: 1px solid #d8ded2;
		border-radius: 12px;
		background: white;
	}
	.ir-view h2 {
		margin: 0;
		font-size: 1.15rem;
	}
	.ir-view p {
		margin: 0.3rem 0 1rem;
		color: #526358;
		font-size: 0.85rem;
	}
	.ir-grid {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0.8rem;
	}
	.ir-grid details {
		min-width: 0;
		border: 1px solid #d8ded2;
		border-radius: 8px;
	}
	.ir-grid summary {
		padding: 0.7rem;
		font-size: 0.82rem;
		font-weight: 650;
		cursor: pointer;
	}
	.ir-grid pre {
		max-height: 32rem;
		margin: 0;
		padding: 0.7rem;
		overflow: auto;
		border-top: 1px solid #d8ded2;
		font-size: 0.7rem;
	}
	.face-witness {
		padding: 1.2rem;
		border: 1px solid #d8ded2;
		border-radius: 12px;
		background: white;
	}
	.face-witness h2 {
		margin: 0 0 0.4rem;
	}
	.face-witness > p {
		max-width: 800px;
		color: #526358;
	}
	.face-toggle {
		display: flex;
		gap: 0.4rem;
		margin: 1rem 0;
	}
	.face-grid {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(280px, 1fr);
		gap: 1rem;
	}
	.face-grid > div {
		min-width: 0;
		padding: 1rem;
		border: 1px solid #d8ded2;
		border-radius: 8px;
	}
	.face-grid h3 {
		margin: 0 0 0.8rem;
		font-size: 1rem;
	}
	.face-options button {
		display: grid;
		gap: 0.15rem;
		width: 100%;
		margin-top: 0.4rem;
		padding: 0.55rem 0.7rem;
		border: 1px solid #d8ded2;
		border-radius: 6px;
		background: white;
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
	}
	.face-options button.active {
		border-color: #2764a5;
		box-shadow: 0 0 0 2px #2764a524;
	}
	.face-options span,
	.face-options small {
		font-size: 0.77rem;
	}
	.face-options small {
		color: #285448;
	}
	.face-options small.rejected {
		color: #9a392a;
	}
	.face-preview svg {
		height: 300px;
		min-height: 0;
	}
	.port-box {
		fill: #f8fbf3;
		stroke: #456858;
		stroke-width: 2;
	}
	.port-point {
		fill: #2764a5;
	}
	.face-preview text {
		fill: #243e32;
		font-size: 11px;
	}
	.face-preview p {
		font-size: 0.85rem;
	}
	@media (max-width: 900px) {
		.configuration,
		.solver-grid,
		.folded-grid {
			display: block;
		}
		.ir-grid {
			grid-template-columns: 1fr;
		}
		.face-grid {
			grid-template-columns: 1fr;
		}
		.controls {
			margin-top: 1rem;
		}
		.trace,
		.folded-details {
			margin-top: 1rem;
		}
	}
</style>
