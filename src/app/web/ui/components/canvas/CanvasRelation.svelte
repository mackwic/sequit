<script lang="ts">
	import { entityKey, EntityKind, entityRef } from '../../canvas/canvas-entity';
	import {
		activateEntityByKeyboard,
		activateEntityByPointer,
	} from '../../canvas/canvas-entity-events';
	import type { RenderedRelation } from '../../canvas/render-relations';
	import type { CanvasSession } from '../../session/canvas-session.svelte';
	import RelationPath from './RelationPath.svelte';

	let {
		relation,
		session,
		markerId,
		tabbable = false,
		ondblclick,
	}: {
		relation: RenderedRelation;
		session: CanvasSession;
		markerId: string;
		tabbable?: boolean;
		/** Double-click inserts a junction on this relation. */
		ondblclick?: ((relationId: string) => void) | undefined;
	} = $props();
	let ref = $derived(entityRef(EntityKind.Relation, relation.id));
	let selected = $derived(session.isSelected(ref));
	let tabIndex = $derived.by(() => {
		if (tabbable) return 0;
		return -1;
	});

	function handleClick(event: MouseEvent) {
		activateEntityByPointer(session, ref, event);
	}

	function handleKeyDown(event: KeyboardEvent) {
		activateEntityByKeyboard(session, ref, event);
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
	tabindex={tabIndex}
	aria-label={`Relation ${relation.id} from ${relation.from} to ${relation.to}`}
	aria-pressed={selected}
	onclick={handleClick}
	ondblclick={(event) => {
		if (ondblclick === undefined) return;
		event.preventDefault();
		event.stopPropagation();
		session.selectEntity(ref);
		ondblclick(relation.id);
	}}
	onkeydown={handleKeyDown}
></path>

<style>
	.relation-hit-target {
		cursor: pointer;
		pointer-events: stroke;
		transition: d var(--canvas-motion-duration) var(--canvas-motion-easing);
	}

	.relation-hit-target:focus-visible {
		stroke: color-mix(in srgb, var(--ui-accent) 28%, transparent);
		outline: none;
	}
</style>
