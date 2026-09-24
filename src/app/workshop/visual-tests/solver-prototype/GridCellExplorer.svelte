<script lang="ts">
	import { EndpointKind } from '../../../../lib/core/document/logic-document';
	import {
		type GridCellLayoutAttempt,
		GridCellLayoutStatus,
		type GridCellSelected,
	} from '../../../../lib/core/layout/grid-cell-types';
	import type { Point } from '../../../../lib/core/layout/layout-types';
	import { runGridCellWitness } from './grid-cell-witness';

	function selectedResult(attempt: GridCellLayoutAttempt): GridCellSelected | undefined {
		if (attempt.status === GridCellLayoutStatus.Selected) return attempt;
		return undefined;
	}

	function failureReason(attempt: GridCellLayoutAttempt): string {
		if (attempt.status === GridCellLayoutStatus.Selected) return '';
		return attempt.reason;
	}

	const witness = runGridCellWitness();
	const selected = selectedResult(witness.attempt);

	function points(path: readonly Point[]): string {
		return path.map(({ x, y }) => `${x},${y}`).join(' ');
	}
</script>

<section class="grid-witness" aria-label="Composition de quatre cellules indépendantes">
	<div class="heading">
		<div>
			<p class="eyebrow">Composition bornée · pipeline réel</p>
			<h2>Quatre cellules, quatre classements locaux</h2>
			<p>
				La relation violette relie le rang local <strong>4</strong> de A au rang local
				<strong>1</strong> de D. Ses rails contournent B et C, traitées comme des régions opaques. Le
				groupe de B élargit sa colonne et sa rangée sans déborder de sa cellule.
			</p>
		</div>
		{#if selected}
			<p class:failed={witness.validation !== undefined} class="status" data-testid="grid-status">
				{#if witness.validation === undefined}
					Validé · 4 cellules · {selected.layout.relations.length} relations
				{:else}
					Rejeté · {witness.validation}
				{/if}
			</p>
		{:else}
			<p class="status failed" role="alert" data-testid="grid-status">
				{witness.attempt.status} · {failureReason(witness.attempt)}
			</p>
		{/if}
	</div>

	{#if selected}
		<div class="metrics" aria-label="Pistes extensibles et rangs locaux">
			<span>Colonnes : {selected.columnWidths.map(Math.round).join(' / ')} px</span>
			<span>Rangées : {selected.rowHeights.map(Math.round).join(' / ')} px</span>
			<span>Source A : rang {witness.localRanks.get('source4')}</span>
			<span>Cible D : rang {witness.localRanks.get('target1')}</span>
		</div>
		<div class="canvas">
			<svg
				role="img"
				aria-label="Grille deux par deux avec une relation du rang quatre de A au rang un de D, détournée hors des quatre cellules"
				viewBox={`0 0 ${selected.layout.width} ${selected.layout.height}`}
			>
				{#each selected.cells as cell (cell.id)}
					<rect
						class="cell"
						x={cell.bounds.x}
						y={cell.bounds.y}
						width={cell.bounds.width}
						height={cell.bounds.height}
						rx="12"
					/>
					<text class="cell-label" x={cell.bounds.x + 17} y={cell.bounds.y + 30}>
						CELLULE {cell.id.toUpperCase()} · rangs locaux
					</text>
				{/each}
				{#each selected.layout.relations.filter(({ id }) => id !== 'across-grid') as relation (relation.id)}
					<polyline class="local-route" points={points(relation.points)} />
				{/each}
				{#each selected.layout.relations.filter(({ id }) => id === 'across-grid') as relation (relation.id)}
					<polyline class="cross-route-halo" points={points(relation.points)} />
					<polyline
						class="cross-route"
						data-testid="grid-cross-route"
						points={points(relation.points)}
					/>
				{/each}
				{#each selected.layout.elements.filter(({ kind }) => kind === EndpointKind.Group) as element (element.id)}
					<rect
						class="group"
						x={element.bounds.x}
						y={element.bounds.y}
						width={element.bounds.width}
						height={element.bounds.height}
						rx="10"
					/>
					<text class="group-label" x={element.bounds.x + 14} y={element.bounds.y + 24}>
						Groupe indivisible · {Math.round(element.bounds.width)} × {Math.round(
							element.bounds.height,
						)}
					</text>
				{/each}
				{#each selected.layout.elements.filter(({ kind }) => kind === EndpointKind.Node) as element (element.id)}
					<rect
						class:cross-endpoint={element.id === 'source4' || element.id === 'target1'}
						class="node"
						x={element.bounds.x}
						y={element.bounds.y}
						width={element.bounds.width}
						height={element.bounds.height}
						rx="7"
					/>
					<text class="node-label" x={element.bounds.x + 10} y={element.bounds.y + 25}>
						{element.id}
					</text>
					<text class="rank-label" x={element.bounds.x + 10} y={element.bounds.y + 46}>
						rang {witness.localRanks.get(element.id)}
					</text>
				{/each}
				{#each selected.portals as portal (`${portal.relationId}:${portal.endpointId}`)}
					<circle class="portal" cx={portal.point.x} cy={portal.point.y} r="7" />
				{/each}
			</svg>
		</div>
		<p class="scope">
			Témoin de composition : quatre enfants directs, une relation entre cellules. Le document
			persistant et le canvas de production ne sélectionnent pas encore cette politique.
		</p>
	{/if}
</section>

<style>
	.grid-witness {
		margin-top: 1.5rem;
		padding: 1.5rem;
		border: 1px solid #d3dcd3;
		border-radius: 16px;
		background: #fff;
	}
	.heading {
		display: flex;
		align-items: start;
		justify-content: space-between;
		gap: 2rem;
	}
	.heading h2 {
		margin: 0.25rem 0 0.5rem;
		font-size: 1.5rem;
	}
	.heading p {
		max-width: 60rem;
		line-height: 1.5;
	}
	.eyebrow {
		margin: 0;
		color: #5f756a;
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}
	.status {
		flex-shrink: 0;
		margin: 0;
		padding: 0.5rem 0.8rem;
		border-radius: 999px;
		background: #e5f3e8;
		color: #246747;
		font-size: 0.78rem;
		font-weight: 700;
	}
	.status.failed {
		background: #fce9e5;
		color: #9a3d33;
	}
	.metrics {
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem;
		margin: 1rem 0;
	}
	.metrics span {
		padding: 0.4rem 0.7rem;
		border: 1px solid #dce4dd;
		border-radius: 8px;
		background: #f7faf7;
		font-size: 0.75rem;
		font-variant-numeric: tabular-nums;
	}
	.canvas {
		overflow: auto;
		border: 1px solid #e1e6df;
		border-radius: 12px;
		background: #fbfcfa;
	}
	svg {
		display: block;
		width: 100%;
		min-width: 1050px;
		height: auto;
	}
	.cell {
		fill: #f0f5f0;
		stroke: #7b9b85;
		stroke-width: 2;
	}
	.cell-label {
		fill: #4c6a55;
		font-size: 15px;
		font-weight: 700;
		letter-spacing: 1px;
	}
	.local-route {
		fill: none;
		stroke: #94aa9e;
		stroke-width: 3;
	}
	.cross-route-halo {
		fill: none;
		stroke: #fff;
		stroke-linecap: round;
		stroke-linejoin: round;
		stroke-width: 13;
	}
	.cross-route {
		fill: none;
		stroke: #684fba;
		stroke-linecap: round;
		stroke-linejoin: round;
		stroke-width: 5;
	}
	.group {
		fill: #fff8e9;
		stroke: #bf9550;
		stroke-width: 2;
	}
	.group-label {
		fill: #8c662e;
		font-size: 14px;
		font-weight: 700;
	}
	.node {
		fill: #fff;
		stroke: #63816d;
		stroke-width: 2;
	}
	.node.cross-endpoint {
		fill: #f3edff;
		stroke: #684fba;
		stroke-width: 3;
	}
	.node-label {
		fill: #213e2c;
		font-size: 15px;
		font-weight: 700;
	}
	.rank-label {
		fill: #6a7c70;
		font-size: 13px;
	}
	.portal {
		fill: #fff;
		stroke: #684fba;
		stroke-width: 3;
	}
	.scope {
		margin-bottom: 0;
		color: #65746b;
		font-size: 0.8rem;
	}
	@media (max-width: 750px) {
		.heading {
			flex-direction: column;
		}
	}
</style>
