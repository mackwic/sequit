<script lang="ts">
	import { LAYOUT_DIRECTIONS, LayoutDirection } from '../../../../lib/core/document/logic-document';
	import { validateFoldedRouteGeometry } from './folded-route-validator';
	import {
		type FoldedRouteAttachment,
		foldedRouteWitnessDocument,
		materializeFoldedRouteWitness,
	} from './folded-route-witness';

	let direction = $state(LayoutDirection.TopToBottom);
	let source = $derived(foldedRouteWitnessDocument(direction));
	let candidate = $derived(materializeFoldedRouteWitness(source, 'G'));
	let geometry = $derived.by(() => {
		if (candidate.ok) return candidate.value;
		return undefined;
	});
	let validation = $derived.by(() => {
		if (geometry === undefined) return undefined;
		return validateFoldedRouteGeometry(source, 'G', geometry);
	});
	function groupAttachmentSource(attachment: FoldedRouteAttachment): string | undefined {
		if (attachment.visibleOwnerId === 'G') return attachment.sourceEndpointId;
		return undefined;
	}
	function failureReason(): string {
		if (candidate.ok) return '';
		return candidate.reason;
	}
	function points(path: readonly { x: number; y: number }[]): string {
		return path.map(({ x, y }) => `${x},${y}`).join(' ');
	}
	function sourceEndpoints(relationId: string): string {
		const relation = geometry?.normalized.relations.find(({ id }) => id === relationId);
		if (relation === undefined) return relationId;
		return `${relation.from.endpointId} → ${relation.to.endpointId}`;
	}
</script>

<section
	class="folded-route-preview"
	data-folded-route-preview
	aria-label="Prototype géométrique du groupe replié"
>
	<header>
		<div>
			<h3>G replié · routage expérimental</h3>
			<p>Le classement suit B → x → A avant repli. Les attaches de G restent liées à B et A.</p>
		</div>
		<label>
			Direction
			<select bind:value={direction} aria-label="Direction du témoin replié">
				{#each LAYOUT_DIRECTIONS as value (value)}<option {value}>{value}</option>{/each}
			</select>
		</label>
	</header>
	{#if geometry}
		<div class="preview-grid">
			<svg role="img" aria-label="Deux routes orthogonales entre G et x" viewBox="0 0 610 580">
				{#each geometry.boxes as box (box.id)}
					<rect
						class:group={box.id === 'G'}
						x={box.bounds.x}
						y={box.bounds.y}
						width={box.bounds.width}
						height={box.bounds.height}
						rx="8"
						data-witness-box={box.id}
					/>
					<text x={box.bounds.x + 14} y={box.bounds.y + 25}>{box.id}</text>
				{/each}
				{#each geometry.routes as route (route.relationId)}
					<polyline
						points={points(route.points)}
						data-witness-route={route.relationId}
						class:reverse={route.relationId === 'x-to-A'}
					/>
				{/each}
				{#each geometry.attachments as attachment (`${attachment.relationId}:${attachment.role}`)}
					<circle
						cx={attachment.point.x}
						cy={attachment.point.y}
						r="6"
						class:derived={attachment.visibleOwnerId === 'G'}
						data-witness-attachment-group={groupAttachmentSource(attachment)}
					/>
				{/each}
			</svg>
			<div class="proof">
				<p role="status">
					{#if validation?.ok}Validation géométrique réussie.{:else}Candidat rejeté : {validation?.diagnostics
							.map(({ message }) => message)
							.join('; ')}{/if}
				</p>
				<h4>Rangs de la source</h4>
				<p>
					{geometry.sourceRanks
						.filter(({ endpointId }) => ['A', 'B', 'x'].includes(endpointId))
						.map(({ endpointId, rank }) => `${endpointId} : ${rank}`)
						.join(' · ')}
				</p>
				<h4>Routes et provenance</h4>
				<ul>
					{#each geometry.routes as route (route.relationId)}
						<li>
							<code>{route.relationId}</code> · {sourceEndpoints(route.relationId)} · source {route.sourceRelationIds.join(
								', ',
							)}
						</li>
					{/each}
				</ul>
				<h4>Attaches dérivées de G</h4>
				<ul>
					{#each geometry.attachments.filter(({ visibleOwnerId }) => visibleOwnerId === 'G') as attachment (`${attachment.relationId}:${attachment.role}`)}
						<li>{attachment.sourceEndpointId} · {attachment.face} · {attachment.role}</li>
					{/each}
				</ul>
			</div>
		</div>
	{:else}
		<p role="alert">Matérialisation refusée : {failureReason()}</p>
	{/if}
</section>

<style>
	.folded-route-preview {
		margin: 1.2rem 0;
		border: 1px solid #d8ded2;
		border-radius: 12px;
		background: white;
		overflow: hidden;
	}
	header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 1rem;
		padding: 1rem 1.2rem;
		border-bottom: 1px solid #e0e7dc;
	}
	h3,
	h4,
	p {
		margin: 0;
	}
	header p {
		margin-top: 0.35rem;
		color: #526358;
	}
	label {
		display: grid;
		gap: 0.3rem;
		font-size: 0.8rem;
		font-weight: 600;
	}
	select {
		padding: 0.4rem;
		border: 1px solid #bdcdb5;
		border-radius: 6px;
		background: white;
	}
	.preview-grid {
		display: grid;
		grid-template-columns: minmax(0, 1.5fr) minmax(230px, 1fr);
		gap: 1rem;
		padding: 1rem;
	}
	svg {
		width: 100%;
		min-height: 300px;
		background: #f8faf5;
	}
	rect {
		fill: #e9f1e9;
		stroke: #456858;
		stroke-width: 2;
	}
	rect.group {
		fill: #dce9df;
	}
	polyline {
		fill: none;
		stroke: #1d6a83;
		stroke-width: 3;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	polyline.reverse {
		stroke: #a35c38;
	}
	circle {
		fill: white;
		stroke: #1d6a83;
		stroke-width: 3;
	}
	circle.derived {
		fill: #ffe6b6;
		stroke: #9b5c20;
	}
	text {
		fill: #243e32;
		font:
			700 18px system-ui,
			sans-serif;
	}
	.proof {
		display: grid;
		align-content: start;
		gap: 0.5rem;
		font-size: 0.83rem;
	}
	.proof p[role='status'] {
		font-weight: 700;
		color: #285448;
	}
	.proof h4 {
		margin-top: 0.4rem;
	}
	.proof ul {
		margin: 0;
		padding-left: 1.2rem;
	}
	@media (max-width: 700px) {
		header,
		.preview-grid {
			grid-template-columns: 1fr;
		}
		header {
			align-items: start;
			flex-direction: column;
		}
	}
</style>
