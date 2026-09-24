<script lang="ts">
	import type { Point } from '../../../../lib/core/layout/layout-types';
	import { compareSharedLanePassages } from './shared-lane-passage-witness';

	const comparison = compareSharedLanePassages();
	let focused = $state(false);
	const viewBox = $derived.by(() => {
		if (focused) return comparison.focusViewBox;
		return comparison.fullViewBox;
	});

	function points(path: readonly Point[]): string {
		return path.map(({ x, y }) => `${x},${y}`).join(' ');
	}
</script>

<section class="passage-explorer" aria-label="Comparaison des passages S SD C">
	<header>
		<div>
			<p class="eyebrow">Même document · même cadre · deux candidats validés</p>
			<h2>Traverser SD : rail extérieur ou passage intérieur ?</h2>
			<p>
				La relation <strong>request</strong> va de C vers S devant un groupe médian vide. Les deux tracés
				utilisent le même graphe, les mêmes mesures, les mêmes boîtes et les mêmes ports. Le rail extérieur
				reste géométriquement valide ; le solveur retient le passage intérieur parce qu’il progresse sans
				détour longitudinal.
			</p>
		</div>
		<button
			type="button"
			aria-pressed={focused}
			data-testid="passage-zoom"
			onclick={() => (focused = !focused)}
		>
			{#if focused}Vue complète{:else}Zoom sur SD{/if}
		</button>
	</header>
	<p class="provenance" data-testid="passage-provenance">
		Document {comparison.document.id} · {comparison.document.nodes.length} nœuds ·
		{comparison.document.groups.length} groupe vide · {comparison.document.relations.length}
		relation · même cadre {comparison.width} × {comparison.height} px
	</p>
	<div class="panels">
		{#each comparison.panels as panel (panel.id)}
			<article class="panel" data-testid={`passage-panel-${panel.id}`}>
				<div class="panel-head">
					<h3>{panel.title}</h3>
					<span class:preferred={panel.preferred} data-testid="passage-status">
						{#if panel.preferred}Sélectionné{:else}Candidat admissible{/if}
					</span>
				</div>
				<svg role="img" aria-label={`${panel.title} pour request`} {viewBox}>
					<rect class="canvas" width={comparison.width} height={comparison.height} />
					{#each panel.geometry.lanes as lane (lane.id)}
						<rect
							class="lane"
							class:middle={lane.id === 'SD'}
							x={lane.bounds.x}
							y={lane.bounds.y}
							width={lane.bounds.width}
							height={lane.bounds.height}
						/>
						<text class="lane-label" x={lane.bounds.x + 12} y={lane.bounds.y + 23}>{lane.id}</text>
					{/each}
					{#each panel.geometry.elements as element (element.id)}
						<rect
							class="element"
							class:group={element.id === 'sd-block'}
							x={element.bounds.x}
							y={element.bounds.y}
							width={element.bounds.width}
							height={element.bounds.height}
							rx="8"
						/>
						<text class="element-label" x={element.bounds.x + 11} y={element.bounds.y + 28}
							>{element.id}</text
						>
					{/each}
					{#each panel.geometry.relations as relation (relation.id)}
						<polyline class="route-underlay" points={points(relation.points)} />
						<polyline
							class="route"
							class:preferred={panel.preferred}
							points={points(relation.points)}
							data-testid={`passage-route-${panel.id}`}
						/>
					{/each}
					<circle class="crossing" cx={panel.middleCrossingX} cy={panel.middleCrossingY} r="6" />
				</svg>
				<div class="metrics" data-testid="passage-metrics">
					<span>Géométrie validée</span>
					<span
						>Monotone : {#if panel.monotone}oui{:else}non{/if}</span
					>
					<span>Longueur : {panel.routeLength} px</span>
					<span>Coudes : {panel.bends}</span>
					<span>Traversée SD : y = {panel.middleCrossingY} px</span>
				</div>
			</article>
		{/each}
	</div>
</section>

<style>
	.passage-explorer {
		margin-top: 1.5rem;
		padding: 1.4rem;
		border: 1px solid #d2ddd8;
		border-radius: 16px;
		background: #fff;
	}
	header {
		display: flex;
		align-items: end;
		justify-content: space-between;
		gap: 1.5rem;
	}
	header > div {
		max-width: 70rem;
	}
	h2,
	h3 {
		margin: 0.3rem 0 0.7rem;
	}
	header p:last-child {
		line-height: 1.5;
		color: #42584f;
	}
	.eyebrow {
		margin: 0;
		font-size: 0.74rem;
		font-weight: 750;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: #56766c;
	}
	button {
		flex: none;
		padding: 0.65rem 0.9rem;
		border: 1px solid #9db5aa;
		border-radius: 8px;
		background: #eff6f1;
		font: inherit;
		cursor: pointer;
	}
	.provenance {
		margin: 0.8rem 0 1.2rem;
		font-size: 0.83rem;
		color: #52665d;
	}
	.panels {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 1rem;
	}
	.panel {
		min-width: 0;
		padding: 1rem;
		border: 1px solid #d4ded8;
		border-radius: 12px;
		background: #f8faf8;
	}
	.panel-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 1rem;
	}
	.panel-head span {
		color: #655a42;
		font-size: 0.82rem;
		font-weight: 700;
	}
	.panel-head span.preferred {
		color: #166b54;
	}
	svg {
		width: 100%;
		max-height: 540px;
		border: 1px solid #e1e8e3;
		border-radius: 8px;
		background: #fff;
	}
	.canvas {
		fill: #fff;
	}
	.lane {
		fill: #edf3f0;
		stroke: #bbcfc3;
		stroke-width: 2;
	}
	.lane.middle {
		fill: #f4efe2;
		stroke: #d0b776;
	}
	.lane-label,
	.element-label {
		font-size: 17px;
		font-weight: 700;
		fill: #314c40;
	}
	.element {
		fill: #e1edfa;
		stroke: #547aa0;
		stroke-width: 2;
	}
	.element.group {
		fill: #fff4d9;
		stroke: #ae8542;
	}
	.route-underlay,
	.route {
		fill: none;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.route-underlay {
		stroke: #fff;
		stroke-width: 10;
	}
	.route {
		stroke: #a8643c;
		stroke-width: 5;
	}
	.route.preferred {
		stroke: #13836c;
	}
	.crossing {
		fill: #fff;
		stroke: #293e39;
		stroke-width: 2;
	}
	.metrics {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem 0.9rem;
		margin-top: 0.6rem;
		font-size: 0.79rem;
		font-variant-numeric: tabular-nums;
		color: #3f544b;
	}
	@media (max-width: 900px) {
		header {
			align-items: start;
			flex-direction: column;
		}
		.panels {
			grid-template-columns: 1fr;
		}
	}
</style>
