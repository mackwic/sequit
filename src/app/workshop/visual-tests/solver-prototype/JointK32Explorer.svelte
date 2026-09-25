<script lang="ts">
	import { resolve } from '$app/paths';

	import { VisualLayout } from '../../../../../tests/support/harnesses/visual-layout';
	import { LayoutDirection } from '../../../../lib/core/document/logic-document';
	import { createGraph } from '../../../../lib/core/graph/create-graph';
	import { topologicallyRank } from '../../../../lib/core/graph/topological-ranks';
	import {
		type IndependentAdjacentResolution,
		type IndependentAdjacentSelection,
		IndependentAdjacentStatus,
		resolveIndependentAdjacentContract,
	} from '../../../../lib/core/layout/contract/independent-adjacent-resolution';
	import { solveJointK32Contract } from '../../solver-prototype/joint-k32-contract';
	import {
		completeJointK32Fixture,
		sparseJointCorridorFixture,
	} from '../../solver-prototype/joint-k32-fixtures';
	import {
		realK32Fixture,
		type RealK32Witness,
		runRealK32Witness,
	} from '../../solver-prototype/real-k32-witness';
	import LayoutPreview from '../LayoutPreview.svelte';

	let routeSet = $state<'sparse' | 'complete'>('sparse');
	let branchBudget = $state(100);
	let inspectedCandidateId = $state('adjacent-d-before-e');
	let inspectedBranchId = $state('');
	let realDirection = $state(LayoutDirection.TopToBottom);
	let realWitnesses = $state<{
		crossed: RealK32Witness;
		shared: RealK32Witness;
	} | null>(null);
	let realError = $state<string | null>(null);

	const fixture = $derived(fixtureFor(routeSet));
	const result = $derived(
		solveJointK32Contract(fixture, {
			maxBranches: Math.min(200, Math.max(0, Math.floor(branchBudget || 0))),
		}),
	);
	const inspected = $derived(
		result.analyses.find(({ candidate }) => candidate.id === inspectedCandidateId) ??
			result.analyses[0],
	);
	const candidateBranches = $derived(
		result.branches.filter(({ candidateId }) => candidateId === inspected?.candidate.id),
	);
	const inspectedBranch = $derived(
		candidateBranches.find(({ id }) => id === inspectedBranchId) ?? candidateBranches[0],
	);
	const crossedLayout = $derived(asVisualLayout(realWitnesses?.crossed, realDirection));
	const sharedLayout = $derived(asVisualLayout(realWitnesses?.shared, realDirection));
	const independent = $derived.by(() => {
		if (routeSet !== 'sparse') return null;
		const fixture = realK32Fixture(realDirection);
		const created = createGraph(fixture.document);
		if (!created.ok) return null;
		const ranks = topologicallyRank(created.value);
		return {
			resolution: resolveIndependentAdjacentContract(created.value, ranks, fixture.measurements, {
				maxBranches: Math.min(200, Math.max(0, Math.floor(branchBudget || 0))),
			}),
			ranks: ranks.byEndpointId,
		};
	});
	const independentSelection = $derived(selectionFor(independent?.resolution));
	const independentLayout = $derived(
		asIndependentVisual(independent?.ranks, independentSelection, realDirection),
	);

	$effect(() => {
		const direction = realDirection;
		const variant = routeSet;
		let active = true;
		realWitnesses = null;
		realError = null;
		void Promise.all([
			runRealK32Witness(direction, 'd-e', variant),
			runRealK32Witness(direction, 'e-d', variant),
		])
			.then(([crossed, shared]) => {
				if (active) realWitnesses = { crossed, shared };
			})
			.catch((error: unknown) => {
				if (active) realError = String(error);
			});
		return () => {
			active = false;
		};
	});

	function minimumFaceSize(analysis: (typeof result.analyses)[number], endpointId: string): string {
		const face = analysis.faces.find(({ endpointId: id }) => id === endpointId);
		const sizes = face?.alternatives
			.filter(({ respectsRequiredSeparations }) => respectsRequiredSeparations)
			.map(({ minimumCrossSize }) => minimumCrossSize);
		if (sizes === undefined || sizes.length === 0) return '?';
		return String(Math.min(...sizes));
	}

	function fixtureFor(value: typeof routeSet) {
		if (value === 'sparse') return sparseJointCorridorFixture();
		return completeJointK32Fixture();
	}

	function asVisualLayout(witness: RealK32Witness | undefined, direction: LayoutDirection) {
		if (witness === undefined) return null;
		return new VisualLayout(witness.layout, witness.ranks, direction);
	}

	function asIndependentVisual(
		ranks: ReadonlyMap<string, number> | undefined,
		selection: IndependentAdjacentSelection | undefined,
		direction: LayoutDirection,
	): VisualLayout | null {
		if (ranks === undefined || selection === undefined) return null;
		return new VisualLayout(selection.layout, ranks, direction);
	}

	function selectionFor(
		resolution: IndependentAdjacentResolution | undefined,
	): IndependentAdjacentSelection | undefined {
		if (resolution?.status === IndependentAdjacentStatus.Selected) return resolution.selection;
		if (resolution?.status === IndependentAdjacentStatus.Incomplete) return resolution.incumbent;
		return undefined;
	}

	function searchStatusLabel() {
		if (result.searchStatus === 'complete') return 'complète';
		return 'incomplète';
	}

	function passageLabel(passage: (typeof fixture.candidates)[number]['passage']) {
		if (passage === 'monotone-adjacent-corridor') return 'Corridor adjacent monotone';
		return 'Autre passage';
	}

	function branchStatusLabel(status: (typeof result.branches)[number]['status']) {
		if (status === 'not-explored') return 'Non explorée';
		return 'Admissible symboliquement';
	}

	function referenceScenario() {
		if (routeSet === 'sparse') return 'conditional-incoming-ports';
		return 'three-incoming-ports';
	}

	function observedFaceLabel(witness: RealK32Witness): string {
		const target = witness.summary.targets.find(({ id }) => id === 'd');
		if (target === undefined) return 'd non observé';
		const count = target.incomingPorts.length;
		let noun = 'ports';
		if (count === 1) noun = 'port';
		return `${target.allocatedCrossSize} px · ${count} ${noun} sur d`;
	}

	function portGroups(groups: readonly (readonly string[])[]): string {
		return groups.map((group) => group.join('+')).join(' | ');
	}
</script>

<section class="joint" aria-label="Recherche conjointe des ordres, croisements et ports">
	<header>
		<div>
			<p class="eyebrow">Contrat calculé par candidat</p>
			<h2>Ordre → croisements → ports</h2>
			<p>
				Chaque ordre et passage candidat recalcule ses inversions, puis les séparations et la
				capacité des faces. Les branches gardent aussi l'ordre physique des ports. Ce contrat reste
				symbolique : ses routes doivent encore être matérialisées et vérifiées.
			</p>
		</div>
		<div class="controls">
			<label
				>Relations
				<select bind:value={routeSet}>
					<option value="sparse">Quatre relations · capacité variable</option>
					<option value="complete">K3,2 · six relations</option>
				</select>
			</label>
			<label
				>Budget de branches
				<input type="number" min="0" max="200" step="1" bind:value={branchBudget} />
			</label>
		</div>
	</header>

	<p class="summary" role="status">
		{result.exploredBranches}/{result.branches.length} branches symboliques explorées · énumération
		{searchStatusLabel()} des branches déduites ·
		{result.analyses.filter(({ status }) => status === 'unknown').length} passage(s) à analyser autrement
		· faisabilité géométrique indéterminée.
		{#if result.incumbent}
			Meilleur contrat parmi les branches explorées, selon croissance, taille de face puis
			inversions forcées :
			{result.incumbent.candidateId}, croissance {result.incumbent.totalGrowth}.
		{/if}
	</p>

	<div class="candidate-grid">
		{#each result.analyses as analysis (analysis.candidate.id)}
			<button
				type="button"
				class:active={inspected?.candidate.id === analysis.candidate.id}
				aria-pressed={inspected?.candidate.id === analysis.candidate.id}
				onclick={() => (inspectedCandidateId = analysis.candidate.id)}
			>
				<strong>{analysis.candidate.targetOrder.join(' < ')}</strong>
				<span>{passageLabel(analysis.candidate.passage)}</span>
				{#if analysis.status === 'unknown'}
					<small>Conflits et ports inconnus pour ce passage</small>
				{:else}
					<small
						>{analysis.conflicts.inversions.length} inversion(s) d'ordre · face d ≥
						{minimumFaceSize(analysis, 'd')} · face e ≥ {minimumFaceSize(analysis, 'e')}</small
					>
				{/if}
			</button>
		{/each}
	</div>

	{#if inspected}
		<div class="detail-grid">
			<div class="diagram">
				<h3>Rangs du candidat, sans coordonnées de layout</h3>
				<svg
					role="img"
					aria-label="Ordre symbolique et relations du candidat"
					viewBox="0 0 440 300"
				>
					{#each fixture.relations as relation (relation.id)}
						<line
							x1="92"
							y1={55 + inspected.candidate.sourceOrder.indexOf(relation.from) * 85}
							x2="348"
							y2={100 + inspected.candidate.targetOrder.indexOf(relation.to) * 100}
							class:crossed={inspected.conflicts.forcedCrossed.includes(relation.id)}
						/>
					{/each}
					{#each inspected.candidate.sourceOrder as source, index (source)}
						<circle cx="92" cy={55 + index * 85} r="19" />
						<text x="92" y={60 + index * 85}>{source}</text>
					{/each}
					{#each inspected.candidate.targetOrder as target, index (target)}
						<circle cx="348" cy={100 + index * 100} r="19" />
						<text x="348" y={105 + index * 100}>{target}</text>
					{/each}
				</svg>
				{#if inspected.status === 'unknown'}
					<p>Ce passage sort du domaine prouvé. Aucune absence de conflit n'est déduite.</p>
				{:else}
					<p>
						{inspected.conflicts.inversions.length} inversion(s) ·
						{inspected.conflicts.requiredSeparations.length} séparation(s) de ports entrants déduite(s)
						pour ce corridor.
						{#if inspected.conflicts.forcedCrossed.length > 0}
							Les traits rouges participent à une inversion forcée par l'ordre.
						{/if}
					</p>
				{/if}
			</div>
			<div class="trace">
				<h3>Partitions et ordres physiques</h3>
				{#if candidateBranches.length === 0}
					<p>Contrat de face inconnu pour ce passage.</p>
				{:else}
					<div class="branches">
						{#each candidateBranches as branch (branch.id)}
							<button
								type="button"
								class:active={inspectedBranch?.id === branch.id}
								onclick={() => (inspectedBranchId = branch.id)}
							>
								<strong>{branchStatusLabel(branch.status)}</strong>
								<span>
									{#each branch.faces as face (face.endpointId)}
										{face.endpointId} : {portGroups(face.physicalPortGroups)} · ≥
										{face.minimumCrossSize}<br />
									{/each}
								</span>
							</button>
						{/each}
					</div>
				{/if}
			</div>
		</div>
	{/if}

	<section class="real" aria-label="Géométrie indépendante du contrat adjacent">
		<h3>Matérialisation indépendante du corridor adjacent clairsemé</h3>
		<p>
			Le graphe réel produit le contrat, puis cette politique place les nœuds, ports, rails et
			routes sans appeler le moteur dédié. Chaque branche est vérifiée sur les boîtes, les attaches,
			les obstacles, les ports et les croisements. Les ordres inversés de ce corridor sont évalués
			dans la limite du budget ; les routes à croisement strict sont rejetées. Les autres motifs et
			passages restent inconnus.
		</p>
		{#if independent?.resolution.status === IndependentAdjacentStatus.Unknown}
			<p role="status">Contrat non résolu : {independent.resolution.reason}.</p>
		{:else if independent}
			<p role="status">
				{independent.resolution.exploredBranches}/{independent.resolution.totalBranches} branches géométriques
				évaluées · candidats inversés exclus par la politique :
				{independent.resolution.omittedCrossingCandidates} · statut global
				{independent.resolution.globalStatus}.
				{#if independent.resolution.status === IndependentAdjacentStatus.Incomplete}
					La recherche est incomplète au budget demandé.
				{/if}
			</p>
			{#if independentLayout && independentSelection}
				<p>
					Candidat retenu dans cette tranche : {independentSelection.candidateId}, croissance totale
					allouée
					{independentSelection.totalGrowth} px.
				</p>
				<LayoutPreview layout={independentLayout} guides={false} />
			{/if}
		{/if}
	</section>

	<section class="real" aria-label="Comparaison avec le moteur actuel">
		<div class="real-header">
			<div>
				<p class="eyebrow">Pipeline réel · graphe → rangs → layout</p>
				<h3>Deux documents de référence, mêmes relations</h3>
				<p>
					Seul l’ordre documentaire de d et e change entre ces références. Le solveur actuel ne
					choisit pas encore entre ces deux ordres pour un même document.
					<a
						href={resolve('/atelier/tests-visuels/[[scenario]]', {
							scenario: referenceScenario(),
						})}>Voir le scénario exécutable →</a
					>
				</p>
			</div>
			<label>
				Croissance des rangs
				<select bind:value={realDirection}>
					<option value={LayoutDirection.TopToBottom}>Haut → bas</option>
					<option value={LayoutDirection.BottomToTop}>Bas → haut</option>
					<option value={LayoutDirection.LeftToRight}>Gauche → droite</option>
					<option value={LayoutDirection.RightToLeft}>Droite → gauche</option>
				</select>
				<small>Les flèches enfant → parent pointent en sens inverse des rangs.</small>
			</label>
		</div>
		{#if realError}
			<p role="alert">{realError}</p>
		{:else if realWitnesses && crossedLayout && sharedLayout}
			<div class="real-grid">
				<div class="real-case">
					<h4>d &lt; e · {observedFaceLabel(realWitnesses.crossed)}</h4>
					<LayoutPreview layout={crossedLayout} guides={false} />
					<p>{realWitnesses.crossed.summary.crossings.length} croisements physiques observés.</p>
				</div>
				<div class="real-case">
					<h4>e &lt; d · {observedFaceLabel(realWitnesses.shared)}</h4>
					<LayoutPreview layout={sharedLayout} guides={false} />
					<p>{realWitnesses.shared.summary.crossings.length} croisements physiques observés.</p>
				</div>
			</div>
			{#if realWitnesses.crossed.summary.assessment !== 'confirmed' || realWitnesses.shared.summary.assessment !== 'confirmed'}
				<p class="diagnostic">
					Comparaison partiellement vérifiée :
					{[
						...realWitnesses.crossed.summary.diagnostics,
						...realWitnesses.shared.summary.diagnostics,
					].join(' ; ')}
				</p>
			{/if}
		{:else}
			<p role="status">Calcul des deux layouts réels…</p>
		{/if}
	</section>

	<details>
		<summary>Inspecter les contrats et la trace</summary>
		<pre>{JSON.stringify(
				{ analysis: inspected, branch: inspectedBranch, trace: result.trace },
				null,
				2,
			)}</pre>
	</details>
</section>

<style>
	.joint {
		line-height: 1.45;
	}
	header {
		display: flex;
		justify-content: space-between;
		gap: 2rem;
		align-items: end;
	}
	header > div:first-child {
		max-width: 670px;
	}
	h2,
	h3 {
		margin: 0.2rem 0 0.5rem;
	}
	header p,
	.diagram p {
		color: #526358;
	}
	.eyebrow {
		color: #5d7b69;
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0.13em;
		text-transform: uppercase;
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
	.controls select,
	.controls input {
		box-sizing: border-box;
		height: 2.5rem;
		padding: 0.45rem;
		border: 1px solid #bdcdb5;
		border-radius: 6px;
		background: white;
		color: inherit;
		font: inherit;
	}
	.controls input {
		width: 6rem;
	}
	.summary {
		padding: 0.7rem 1rem;
		border-radius: 8px;
		background: #e8f3e9;
		color: #285448;
	}
	.candidate-grid {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0.7rem;
		margin: 1rem 0;
	}
	.candidate-grid button,
	.branches button {
		display: grid;
		gap: 0.25rem;
		padding: 0.7rem;
		border: 1px solid #d8ded2;
		border-radius: 8px;
		background: white;
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
	}
	.candidate-grid button.active,
	.branches button.active {
		border-color: #2764a5;
		box-shadow: 0 0 0 2px #2764a524;
	}
	.candidate-grid small {
		color: #526358;
	}
	.detail-grid {
		display: grid;
		grid-template-columns: minmax(0, 1.2fr) minmax(290px, 1fr);
		gap: 1rem;
	}
	.diagram,
	.trace,
	details {
		min-width: 0;
		padding: 1rem;
		border: 1px solid #d8ded2;
		border-radius: 10px;
		background: white;
	}
	svg {
		display: block;
		width: 100%;
		max-height: 410px;
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
	.branches {
		display: grid;
		gap: 0.45rem;
		max-height: 415px;
		overflow: auto;
	}
	details {
		margin-top: 1rem;
	}
	pre {
		max-height: 360px;
		overflow: auto;
		padding: 0.7rem;
		background: #f5f7f2;
		font-size: 0.72rem;
	}
	@media (max-width: 880px) {
		header,
		.detail-grid {
			display: block;
		}
		.candidate-grid {
			grid-template-columns: 1fr;
		}
		.controls,
		.trace {
			margin-top: 1rem;
		}
	}
	.real {
		margin-top: 1rem;
		padding: 1rem;
		border: 1px solid #d8ded2;
		border-radius: 10px;
		background: white;
	}
	.real-header {
		display: flex;
		justify-content: space-between;
		align-items: end;
		gap: 2rem;
	}
	.real-header p {
		max-width: 760px;
		color: #526358;
	}
	.real-header label {
		display: grid;
		gap: 0.2rem;
		font-size: 0.78rem;
		font-weight: 600;
	}
	.real-header select {
		height: 2.5rem;
		padding: 0.45rem;
		border: 1px solid #bdcdb5;
		border-radius: 6px;
		background: white;
		color: inherit;
		font: inherit;
	}
	.real-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 1rem;
	}
	.real-case {
		min-width: 0;
		border: 1px solid #d8ded2;
		border-radius: 8px;
		overflow: hidden;
	}
	.real-case h4,
	.real-case p {
		margin: 0.7rem;
	}
	.real-case :global(svg) {
		display: block;
		width: 100%;
		height: auto;
		max-height: 470px;
		background: #fcfdf9;
	}
	.diagnostic {
		padding: 0.7rem;
		border-radius: 7px;
		background: #fff2df;
	}
	@media (max-width: 880px) {
		.real-header {
			display: block;
		}
		.real-grid {
			grid-template-columns: 1fr;
		}
	}
</style>
