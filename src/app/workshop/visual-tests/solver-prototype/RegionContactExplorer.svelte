<script lang="ts">
	import type { Point } from '../../../../lib/core/layout/layout-types';
	import {
		type RegionContactCase,
		RegionContactCaseId,
		RegionContactPanelStatus,
		runRegionContactWitnesses,
	} from './region-contact-witness';

	const cases = runRegionContactWitnesses();
	const focused = $state({
		[RegionContactCaseId.Parent]: false,
		[RegionContactCaseId.Grid]: false,
	});

	function points(path: readonly Point[]): string {
		return path.map(({ x, y }) => `${x},${y}`).join(' ');
	}

	function ownerColor(regionId: string): string {
		if (regionId === '@root') return '#355c7d';
		if (regionId === 'branch' || regionId === 'grid') return '#ad6827';
		return '#6e4ba8';
	}

	function viewBox(witness: RegionContactCase): string {
		if (focused[witness.id]) return witness.focusViewBox;
		return `0 0 ${witness.width} ${witness.height}`;
	}
</script>

<section class="contact-explorer" aria-label="Contacts aux frontières de régions">
	<header>
		<p class="eyebrow">Contrats incidents · deux vrais documents, trois falsifications</p>
		<h2>Partager un portail, franchir ou contourner ?</h2>
		<p>
			Chaque rangée compare des géométries sur le même document, avec les mêmes mesures et le même
			cadre. Les couleurs identifient le propriétaire de chaque morceau : racine, disposition
			interne ou feuille. Un cercle marque un portail déclaré. Les candidats barrés sont rejetés par
			les oracles ; aucun pont n’est présenté comme solution.
		</p>
	</header>

	<div class="legend" aria-label="Propriétaires des routes">
		<span><i class="root"></i> Racine</span>
		<span><i class="parent"></i> Parent ou grille</span>
		<span><i class="leaf"></i> Feuille</span>
		<span><i class="portal"></i> Portail</span>
	</div>

	{#each cases as witness (witness.id)}
		<section class="case" aria-label={witness.title} data-testid={`contact-case-${witness.id}`}>
			<div class="case-heading">
				<div>
					<h3>{witness.title}</h3>
					<p>{witness.description}</p>
					<p class="provenance">
						Document {witness.source.document.id} · {witness.source.document.nodes.length} nœuds ·
						{witness.source.document.relations.length} relations
					</p>
				</div>
				<div class="frame-controls">
					<span class="same-frame"
						>Même cadre · {Math.round(witness.width)} × {Math.round(witness.height)} px</span
					>
					<button
						type="button"
						aria-pressed={focused[witness.id]}
						data-testid={`contact-zoom-${witness.id}`}
						onclick={() => (focused[witness.id] = !focused[witness.id])}
					>
						{#if focused[witness.id]}
							Vue complète
						{:else}
							Zoom sur le contact
						{/if}
					</button>
				</div>
			</div>
			<div class="panels">
				{#each witness.panels as panel (panel.id)}
					<article
						class="panel"
						class:rejected={panel.status === RegionContactPanelStatus.Rejected}
						data-testid={`contact-panel-${witness.id}-${panel.id}`}
					>
						<div class="panel-heading">
							<h4>{panel.title}</h4>
							<span class="badge" data-testid="contact-status">
								{#if panel.status === RegionContactPanelStatus.Validated}
									Validé
								{:else}
									Rejeté
								{/if}
							</span>
						</div>
						<p class="description">{panel.description}</p>
						<svg
							role="img"
							aria-label={`${witness.title} : ${panel.title}`}
							viewBox={viewBox(witness)}
						>
							<rect class="canvas" width={witness.width} height={witness.height} />
							{#each panel.selected.regions as region (region.id)}
								<rect
									class="region"
									x={region.bounds.x}
									y={region.bounds.y}
									width={region.bounds.width}
									height={region.bounds.height}
									rx="9"
								/>
								<text class="region-label" x={region.bounds.x + 10} y={region.bounds.y + 21}
									>{region.id}</text
								>
							{/each}
							{#each panel.selected.layout.relations as relation (relation.id)}
								<polyline class="route-underlay" points={points(relation.points)} />
							{/each}
							{#each panel.selected.ownedRoutes as piece, index (`${piece.relationId}-${piece.regionId}-${index}`)}
								<polyline
									class="owned-route"
									stroke={ownerColor(piece.regionId)}
									points={points(piece.points)}
									data-testid={`owned-${piece.relationId}-${piece.regionId}`}
								>
									<title>{piece.relationId} · morceau possédé par {piece.regionId}</title>
								</polyline>
							{/each}
							{#each panel.selected.layout.elements as element (element.id)}
								<rect
									class="node"
									x={element.bounds.x}
									y={element.bounds.y}
									width={element.bounds.width}
									height={element.bounds.height}
									rx="7"
								/>
								<text class="node-label" x={element.bounds.x + 10} y={element.bounds.y + 27}
									>{element.id}</text
								>
							{/each}
							{#each panel.selected.portals as portal, index (`${portal.relationId}-${portal.regionId}-${index}`)}
								<circle
									class="portal-mark"
									cx={portal.point.x}
									cy={portal.point.y}
									r="7"
									data-testid={`portal-${portal.relationId}-${portal.regionId}`}
								>
									<title>{portal.relationId} · portail de {portal.regionId}</title>
								</circle>
							{/each}
							{#if panel.probe}
								<polyline
									class="strict-probe"
									points={points(panel.probe.points)}
									data-testid="strict-crossing-probe"
								/>
								<circle
									class="strict-crossing"
									cx={panel.probe.crossing.x}
									cy={panel.probe.crossing.y}
									r="9"
									data-testid="strict-crossing-point"
								/>
							{/if}
						</svg>
						<div class="validation" data-testid="contact-validation">
							<strong>{panel.validator}</strong>
							<span>{panel.reason ?? 'Aucun défaut géométrique détecté.'}</span>
						</div>
						<details>
							<summary>
								{panel.selected.ownedRoutes.length} morceaux · {panel.selected.portals.length}
								portails
							</summary>
							<ul>
								{#each panel.selected.ownedRoutes as piece, index (`${piece.relationId}-${piece.regionId}-${index}`)}
									<li>{piece.relationId} : {piece.regionId}</li>
								{/each}
							</ul>
						</details>
					</article>
				{/each}
			</div>
		</section>
	{/each}

	<aside class="decision">
		<h3>Choix visuel à arbitrer</h3>
		<p>
			D’abord le confinement, les faces, les propriétaires et l’absence de faux contacts. Ensuite,
			comparer la lisibilité des attaches : séparer les portails, partager un tronc avec une
			jonction explicite, ou déplacer un corridor. Un pont à un vrai croisement exige un dégagement
			: l’oracle de pont le valide, le rendu trace l’arc, et la marque reste dérivée des routes ; un
			contact en T ou un recouvrement colinéaire reste rejeté. La longueur, les coudés et l’aire
			départagent seulement des candidats déjà admissibles.
		</p>
	</aside>
</section>

<style>
	.contact-explorer {
		margin-top: 1.5rem;
		padding: 1.5rem;
		border: 1px solid #d5ddd4;
		border-radius: 16px;
		background: #fff;
	}
	header h2 {
		margin: 0.25rem 0 0.65rem;
		font-size: 1.6rem;
	}
	header > p:last-child {
		max-width: 74rem;
		line-height: 1.55;
	}
	.eyebrow {
		margin: 0;
		color: #647969;
		font-size: 0.72rem;
		font-weight: 750;
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}
	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: 1rem;
		margin: 1.1rem 0 1.4rem;
		color: #52665a;
		font-size: 0.8rem;
	}
	.legend span {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
	}
	.legend i {
		display: inline-block;
		width: 14px;
		height: 4px;
		border-radius: 3px;
	}
	.legend .root {
		background: #355c7d;
	}
	.legend .parent {
		background: #ad6827;
	}
	.legend .leaf {
		background: #6e4ba8;
	}
	.legend .portal {
		width: 11px;
		height: 11px;
		border: 2px solid #202e38;
		border-radius: 50%;
	}
	.case + .case {
		margin-top: 2rem;
		padding-top: 1.8rem;
		border-top: 1px solid #dce3da;
	}
	.case-heading {
		display: flex;
		align-items: start;
		justify-content: space-between;
		gap: 1.2rem;
	}
	.case-heading h3 {
		margin: 0 0 0.35rem;
		font-size: 1.16rem;
	}
	.case-heading p {
		margin: 0 0 0.9rem;
		line-height: 1.45;
	}
	.case-heading .provenance {
		margin-top: -0.45rem;
		color: #63766a;
		font-size: 0.78rem;
	}
	.same-frame {
		flex-shrink: 0;
		padding: 0.4rem 0.65rem;
		border: 1px solid #d5dfd6;
		border-radius: 8px;
		color: #52665a;
		font-size: 0.75rem;
		font-variant-numeric: tabular-nums;
	}
	.frame-controls {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 0.5rem;
	}
	.frame-controls button {
		padding: 0.4rem 0.65rem;
		border: 1px solid #7b9e87;
		border-radius: 8px;
		background: #f5faf6;
		color: #2d6343;
		font-size: 0.75rem;
		font-weight: 700;
		cursor: pointer;
	}
	.frame-controls button[aria-pressed='true'] {
		background: #e1f1e5;
	}
	.panels {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
		gap: 0.8rem;
	}
	.panel {
		min-width: 0;
		overflow: hidden;
		border: 1px solid #bed5c4;
		border-radius: 11px;
		background: #fafffb;
	}
	.panel.rejected {
		border-color: #e5c1a9;
		background: #fffaf6;
	}
	.panel-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		padding: 0.85rem 0.9rem 0;
	}
	.panel-heading h4 {
		margin: 0;
		font-size: 0.95rem;
	}
	.badge {
		padding: 0.2rem 0.45rem;
		border-radius: 5px;
		background: #e1f1e5;
		color: #246641;
		font-size: 0.72rem;
		font-weight: 750;
	}
	.rejected .badge {
		background: #fde9db;
		color: #8b4620;
	}
	.description {
		min-height: 2.5rem;
		margin: 0.45rem 0.9rem 0.7rem;
		font-size: 0.78rem;
		line-height: 1.4;
	}
	svg {
		display: block;
		width: 100%;
		height: auto;
		border-top: 1px solid #e3eae3;
		border-bottom: 1px solid #e3eae3;
	}
	.canvas {
		fill: #fcfdfa;
	}
	.region {
		fill: #f5f8f4;
		fill-opacity: 0.55;
		stroke: #93a99a;
		stroke-width: 2;
	}
	.region-label {
		fill: #718176;
		font-size: 18px;
		font-weight: 700;
	}
	.route-underlay {
		fill: none;
		stroke: #fff;
		stroke-linecap: round;
		stroke-linejoin: round;
		stroke-width: 11;
	}
	.owned-route {
		fill: none;
		stroke-linecap: round;
		stroke-linejoin: round;
		stroke-width: 4;
	}
	.node {
		fill: #fff;
		stroke: #4f705b;
		stroke-width: 2;
	}
	.node-label {
		fill: #294936;
		font-size: 19px;
		font-weight: 700;
	}
	.portal-mark {
		fill: #fff;
		stroke: #283c47;
		stroke-width: 3;
	}
	.strict-probe {
		fill: none;
		stroke: #c03535;
		stroke-dasharray: 10 7;
		stroke-width: 5;
	}
	.strict-crossing {
		fill: #fff;
		stroke: #c03535;
		stroke-width: 4;
	}
	.validation {
		display: grid;
		gap: 0.2rem;
		padding: 0.7rem 0.9rem;
		font-size: 0.75rem;
		line-height: 1.4;
	}
	.validation strong {
		color: #4e6856;
	}
	.rejected .validation strong {
		color: #985629;
	}
	details {
		padding: 0 0.9rem 0.8rem;
		color: #516456;
		font-size: 0.72rem;
	}
	summary {
		cursor: pointer;
	}
	details ul {
		columns: 2;
		margin-bottom: 0;
		padding-left: 1rem;
	}
	.decision {
		margin-top: 1.8rem;
		padding: 1rem 1.1rem;
		border-left: 4px solid #789781;
		border-radius: 5px;
		background: #f1f7f2;
	}
	.decision h3 {
		margin: 0 0 0.3rem;
		font-size: 0.98rem;
	}
	.decision p {
		margin: 0;
		line-height: 1.48;
	}
	@media (max-width: 760px) {
		.case-heading {
			flex-direction: column;
		}
	}
</style>
