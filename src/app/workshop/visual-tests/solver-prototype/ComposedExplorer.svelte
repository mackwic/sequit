<script lang="ts">
	import { composedFixture, composedSettings } from '../../solver-prototype/composed-fixtures';
	import {
		type ComposedCandidate,
		type ComposedGeometry,
		solveComposedSlice,
	} from '../../solver-prototype/composed-slice';

	let kind = $state<'free' | 'blocking'>('free');
	let orientation = $state<'vertical' | 'horizontal'>('vertical');
	let separationMode = $state<'none' | 'one' | 'three'>('three');
	let budget = $state(65);
	let inspectedId = $state('');

	const fixture = $derived.by(() => {
		const input = composedFixture(kind, orientation);
		const requiredSeparations = input.requiredSeparations ?? [];
		let selectedSeparations = requiredSeparations;
		if (separationMode === 'none') selectedSeparations = [];
		if (separationMode === 'one') selectedSeparations = requiredSeparations.slice(0, 1);
		return {
			...input,
			requiredSeparations: selectedSeparations,
		};
	});
	const solution = $derived(
		solveComposedSlice(fixture, composedSettings({ budget: Math.max(0, Math.floor(budget || 0)) })),
	);
	const selected = $derived(solution.candidates.find(({ id }) => id === solution.selectedId));
	const inspected = $derived(
		solution.candidates.find(({ id }) => id === inspectedId) ?? selected ?? solution.candidates[0],
	);
	const geometry = $derived(inspected?.geometry ?? selected?.geometry);

	function points(path: readonly { x: number; y: number }[]): string {
		return path.map(({ x, y }) => `${x},${y}`).join(' ');
	}

	function viewBoxFor(value: ComposedGeometry): string {
		const rects = [...value.lanes, ...value.boxes].map(({ bounds }) => bounds);
		const pathPoints = value.paths.flatMap(({ points: route }) => route);
		const left = Math.min(...rects.map(({ x }) => x), ...pathPoints.map(({ x }) => x)) - 35;
		const top = Math.min(...rects.map(({ y }) => y), ...pathPoints.map(({ y }) => y)) - 35;
		const right =
			Math.max(...rects.map(({ x, width }) => x + width), ...pathPoints.map(({ x }) => x)) + 35;
		const bottom =
			Math.max(...rects.map(({ y, height }) => y + height), ...pathPoints.map(({ y }) => y)) + 35;
		return `${left} ${top} ${right - left} ${bottom - top}`;
	}

	function status(candidate: ComposedCandidate): string {
		if (candidate.status === 'selected') {
			if (solution.truncated) return 'Provisoire';
			return 'Retenue';
		}
		if (candidate.status === 'feasible') return 'Admissible';
		if (candidate.status === 'not-explored') return 'Non explorée';
		return 'Rejetée';
	}
</script>

<section class="composed" aria-label="Recherche composée de passages et de ports">
	<header>
		<div>
			<p class="eyebrow">Produit de contrats symboliques</p>
			<h2>Trois routes · S | SD | C</h2>
			<p>
				Les cinq partitions de ports sont croisées avec les passages et rangs avant les coordonnées.
				Les séparations sont des contraintes fournies à cette fixture : les trois arrivées seules ne
				les démontrent pas. Ce sous-problème cherche des routes sans croisement entre elles.
			</p>
		</div>
		<div class="controls">
			<label
				>SD
				<select bind:value={kind}>
					<option value="free">Passage libre</option>
					<option value="blocking">Groupe bloquant</option>
				</select>
			</label>
			<label
				>Orientation
				<select bind:value={orientation}>
					<option value="vertical">Lanes verticales</option>
					<option value="horizontal">Lanes horizontales</option>
				</select>
			</label>
			<label
				>Séparations fournies
				<select bind:value={separationMode}>
					<option value="none">Aucune</option>
					<option value="one">Une paire</option>
					<option value="three">Trois paires</option>
				</select>
			</label>
			<label
				>Budget de branches
				<input type="number" min="0" max="65" step="1" bind:value={budget} />
			</label>
		</div>
	</header>

	<p class="summary" role="status">
		{solution.explored}/{solution.candidates.length} branches explorées ·
		{solution.candidates.filter(({ status: state }) => state === 'rejected').length} rejets ·
		{solution.candidates.filter(({ status: state }) => state === 'feasible' || state === 'selected')
			.length}
		admissibles.
		{#if solution.truncated}
			Recherche incomplète.
			{#if solution.selectedId !== undefined}
				{solution.selectedId} est un meilleur candidat provisoire.
			{/if}
		{:else if solution.outcome === 'infeasible'}
			Aucune branche admissible dans ce contrat borné.
		{:else}
			Meilleur candidat du contrat borné : {solution.selectedId}.
		{/if}
	</p>

	<div class="grid">
		<div class="diagram">
			<h3>{inspected?.id ?? 'Aucune branche inspectée'}</h3>
			{#if geometry}
				<svg
					role="img"
					aria-label="Trois routes, ports et obstacles du candidat"
					viewBox={viewBoxFor(geometry)}
				>
					{#each geometry.lanes as lane (lane.id)}
						<rect class="lane" {...lane.bounds} />
						<text class="lane-label" x={lane.bounds.x + 9} y={lane.bounds.y + 17}>{lane.id}</text>
					{/each}
					{#each geometry.boxes as box (box.id)}
						<rect class:group={box.kind === 'group'} class="box" {...box.bounds} rx="5" />
						<text class="box-label" x={box.bounds.x + 6} y={box.bounds.y + 17}>{box.id}</text>
					{/each}
					{#each geometry.paths as path, index (path.relationId)}
						<polyline class={`route route-${index}`} points={points(path.points)} />
						<circle
							class={`port port-${index}`}
							cx={path.targetPort.x}
							cy={path.targetPort.y}
							r="5"
						/>
					{/each}
				</svg>
				<p class="caption">
					Face {geometry.targetFace} · taille tangentielle {geometry.targetLongitudinalSize} · gouttière
					{geometry.allocatedLaneGap} · rangs {geometry.allocatedRankGap}.
				</p>
			{:else}
				<p class="empty">Cette branche est rejetée avant matérialisation ou non explorée.</p>
			{/if}
		</div>
		<div class="trace">
			<h3>Trace des {solution.candidates.length} branches</h3>
			<div class="branches">
				{#each solution.candidates as candidate (candidate.id)}
					<button
						type="button"
						class:active={candidate.id === inspected?.id}
						onclick={() => (inspectedId = candidate.id)}
					>
						<span class="branch-head"
							><strong>{candidate.id}</strong><em>{status(candidate)}</em></span
						>
						<span>{candidate.portGroups.map((group) => group.join('+')).join(' | ')}</span>
						<span
							>{candidate.portCount} port(s) · ordre physique {candidate.portOrderIndex + 1}</span
						>
						<span
							>Face ≥ {candidate.demands.targetFaceLongitudinalSize} · lane ≥ {candidate.demands
								.laneGap} · rang ≥ {candidate.demands.rankGap}</span
						>
						{#if candidate.reason}<span class="reason"
								>{candidate.rejectionPhase ?? 'budget'} : {candidate.reason}</span
							>{/if}
						{#if candidate.score}<span>Score [{candidate.score.join(', ')}]</span>{/if}
					</button>
				{/each}
			</div>
		</div>
	</div>
	<details>
		<summary>Voir les IR et demandes avant coordonnées</summary>
		<div class="ir">
			<pre>{JSON.stringify(solution.layering, null, 2)}</pre>
			<pre>{JSON.stringify(solution.passageContract, null, 2)}</pre>
			<pre>{JSON.stringify(solution.faceContract, null, 2)}</pre>
		</div>
	</details>
</section>

<style>
	.composed {
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
		max-width: 630px;
	}
	h2,
	h3 {
		margin: 0.2rem 0 0.5rem;
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
	.controls {
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem;
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
	.grid {
		display: grid;
		grid-template-columns: minmax(0, 1.3fr) minmax(320px, 1fr);
		gap: 1rem;
	}
	.diagram,
	.trace {
		min-width: 0;
		border: 1px solid #d8ded2;
		border-radius: 10px;
		background: white;
		overflow: hidden;
	}
	.diagram h3,
	.trace h3 {
		padding: 0.9rem 1rem;
		border-bottom: 1px solid #e0e7dc;
		font-size: 1rem;
	}
	svg {
		display: block;
		box-sizing: border-box;
		width: 100%;
		height: min(65vw, 620px);
		min-height: 370px;
		padding: 1rem;
		background: #fcfdf9;
	}
	.lane {
		fill: #eaf0e5;
		stroke: #9bb29e;
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
		font-size: 10px;
		font-weight: 650;
	}
	.route {
		fill: none;
		stroke-width: 3;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.route-0 {
		stroke: #2764a5;
	}
	.route-1 {
		stroke: #aa6330;
	}
	.route-2 {
		stroke: #804ba2;
	}
	.port-0 {
		fill: #2764a5;
	}
	.port-1 {
		fill: #aa6330;
	}
	.port-2 {
		fill: #804ba2;
	}
	.caption,
	.empty {
		padding: 0 1rem;
		color: #526358;
		font-size: 0.84rem;
	}
	.branches {
		display: grid;
		gap: 0.4rem;
		max-height: 665px;
		overflow: auto;
		padding: 0 0.7rem 0.7rem;
	}
	.branches button {
		display: grid;
		gap: 0.2rem;
		width: 100%;
		padding: 0.6rem;
		border: 1px solid #d8ded2;
		border-radius: 7px;
		background: white;
		color: inherit;
		font: inherit;
		font-size: 0.76rem;
		text-align: left;
		cursor: pointer;
	}
	.branches button.active {
		border-color: #2764a5;
		box-shadow: 0 0 0 2px #2764a524;
	}
	.branch-head {
		display: flex;
		justify-content: space-between;
		gap: 0.5rem;
	}
	.branch-head em {
		font-style: normal;
		font-weight: 700;
		color: #285448;
	}
	.reason {
		color: #9a392a;
	}
	details {
		margin-top: 1rem;
		border: 1px solid #d8ded2;
		border-radius: 8px;
		padding: 0.7rem;
		background: white;
	}
	.ir {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0.7rem;
	}
	pre {
		overflow: auto;
		max-height: 320px;
		font-size: 0.7rem;
		background: #f5f7f2;
		padding: 0.7rem;
	}
	@media (max-width: 900px) {
		header,
		.grid {
			display: block;
		}
		.controls,
		.trace {
			margin-top: 1rem;
		}
		.ir {
			grid-template-columns: 1fr;
		}
	}
</style>
