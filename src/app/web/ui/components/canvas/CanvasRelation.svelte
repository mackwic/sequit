<script lang="ts">
	import { entityKey, EntityKind, entityRef } from '../../canvas/canvas-entity';
	import type { RenderedRelation } from '../../canvas/render-relations';
	import type { CanvasSession } from '../../session/canvas-session.svelte';
	import RelationPath from './RelationPath.svelte';

	let {
		relation,
		session,
		markerId,
	}: { relation: RenderedRelation; session: CanvasSession; markerId: string } = $props();
	let ref = $derived(entityRef(EntityKind.Relation, relation.id));
	let selected = $derived(session.isSelected(ref));

	function handleClick(event: MouseEvent) {
		event.stopPropagation();
		if (event.metaKey || event.ctrlKey) session.toggleEntity(ref);
		else session.selectEntity(ref);
	}

	function handleKeyDown(event: KeyboardEvent) {
		if (event.code === 'Space') {
			event.preventDefault();
			event.stopPropagation();
			session.toggleEntity(ref);
		} else if (event.code === 'Enter') {
			event.preventDefault();
			event.stopPropagation();
			session.selectEntity(ref);
		}
	}
</script>

<RelationPath {relation} {selected} {markerId} />
<path
	class="relation-hit-target"
	data-relation-id={relation.id}
	data-edge-from={relation.from}
	data-edge-to={relation.to}
	data-canvas-entity-key={entityKey(ref.kind, ref.id)}
	d={relation.path}
	fill="none"
	stroke="transparent"
	stroke-width="16"
	stroke-linejoin="round"
	stroke-linecap="round"
	vector-effect="non-scaling-stroke"
	role="button"
	tabindex="-1"
	aria-label={`Relation ${relation.id} from ${relation.from} to ${relation.to}`}
	aria-pressed={selected}
	onclick={handleClick}
	onkeydown={handleKeyDown}
></path>

<style>
	.relation-hit-target {
		cursor: pointer;
		pointer-events: stroke;
	}

	.relation-hit-target:focus-visible {
		stroke: color-mix(in srgb, var(--ui-accent) 28%, transparent);
		outline: none;
	}
</style>
