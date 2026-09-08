<script lang="ts">
	import { SvelteSet } from 'svelte/reactivity';

	import { EntityKind, entityRefFromKey } from '$lib/canvas/canvas-entity';
	import Icon from '$lib/components/ui/Icon.svelte';

	import type { WorkbenchToolProps } from '../workshop-types';
	let { session, viewport, presentation, report, model }: WorkbenchToolProps = $props();
	let multi = $state(false);
	let space = false;
	let box = $state<{ x: number; y: number; width: number; height: number }>();
	$effect(() => {
		if (!viewport) return;
		const area = viewport;
		let suppressClick = false;
		let cleanupDrag = () => undefined;
		function click(event: MouseEvent) {
			if (suppressClick) {
				suppressClick = false;
				event.preventDefault();
				event.stopImmediatePropagation();
				return;
			}
			if (!multi || !(event.target instanceof Element)) return;
			const key = event.target
				.closest('[data-canvas-entity-key]')
				?.getAttribute('data-canvas-entity-key');
			if (key == null || key === '') return;
			event.preventDefault();
			event.stopImmediatePropagation();
			session.toggleEntity(entityRefFromKey(key));
		}
		function down(event: PointerEvent) {
			if (
				event.button !== 0 ||
				!(event.target instanceof Element) ||
				event.target.closest('[data-canvas-entity-key]')
			)
				return;
			if (presentation === 'mode' && !multi) return;
			if (space || event.altKey || session.editing) return;
			cleanupDrag();
			area.focus({ preventScroll: true });
			const x = event.clientX,
				y = event.clientY;
			let moved = false;
			const move = (next: PointerEvent) => {
				moved ||= Math.hypot(next.clientX - x, next.clientY - y) > 5;
				if (moved) {
					box = {
						x: Math.min(x, next.clientX),
						y: Math.min(y, next.clientY),
						width: Math.abs(next.clientX - x),
						height: Math.abs(next.clientY - y),
					};
				}
			};
			const up = () => {
				cleanupDrag();
				if (box) {
					suppressClick = true;
					if (!event.metaKey && !event.ctrlKey) session.clearSelection();
					for (const item of area.querySelectorAll(
						'[data-canvas-entity-key]:not([data-relation-id])',
					)) {
						const bounds = item.getBoundingClientRect();
						const key = item.getAttribute('data-canvas-entity-key');
						if (
							key != null &&
							key !== '' &&
							bounds.right >= box.x &&
							bounds.left <= box.x + box.width &&
							bounds.bottom >= box.y &&
							bounds.top <= box.y + box.height
						)
							session.addEntity(entityRefFromKey(key));
					}
					report(`${session.selectionCount} éléments sélectionnés.`);
				}
				box = undefined;
			};
			cleanupDrag = () => {
				window.removeEventListener('pointermove', move);
				window.removeEventListener('pointerup', up);
				window.removeEventListener('pointercancel', cancel);
				window.removeEventListener('blur', cancel);
				window.removeEventListener('keydown', escape, true);
			};
			const cancel = () => {
				cleanupDrag();
				box = undefined;
			};
			const escape = (event: KeyboardEvent) => {
				if (event.key === 'Escape') {
					cancel();
					event.preventDefault();
					event.stopPropagation();
				}
			};
			window.addEventListener('blur', cancel, { once: true });
			window.addEventListener('keydown', escape, true);
			window.addEventListener('pointercancel', cancel, { once: true });
			window.addEventListener('pointermove', move);
			window.addEventListener('pointerup', up, { once: true });
		}
		area.addEventListener('click', click, true);
		area.addEventListener('pointerdown', down, true);
		return () => {
			cleanupDrag();
			area.removeEventListener('click', click, true);
			area.removeEventListener('pointerdown', down, true);
		};
	});
	function all() {
		session.clearSelection();
		for (const node of model.nodes) session.addEntity({ kind: EntityKind.Node, id: node.id });
	}
	function neighbors() {
		const ids = new Set([...session.selection.values()].map((ref) => ref.id));
		const next = new SvelteSet(ids);
		for (const relation of model.relations) {
			if (ids.has(relation.from)) next.add(relation.to);
			if (ids.has(relation.to)) next.add(relation.from);
		}
		for (const node of model.nodes)
			if (next.has(node.id) || (node.groupId !== undefined && ids.has(node.groupId)))
				session.addEntity({ kind: EntityKind.Node, id: node.id });
		for (const group of model.groups)
			if (next.has(group.id)) session.addEntity({ kind: EntityKind.Group, id: group.id });
		for (const junction of model.junctions)
			if (next.has(junction.id)) session.addEntity({ kind: EntityKind.Junction, id: junction.id });
	}
</script>

<svelte:window
	onkeydown={(event: KeyboardEvent) => {
		if (event.code === 'Space') space = true;
	}}
	onkeyup={(event: KeyboardEvent) => {
		if (event.code === 'Space') space = false;
	}}
	onblur={() => {
		space = false;
	}}
/>

<div class="wb-tools">
	<h2>Composer une sélection</h2>
	{#if presentation === 'mode'}<button
			type="button"
			aria-pressed={multi}
			onclick={() => {
				multi = !multi;
			}}
			>Sélection multiple {#if multi}active{:else}inactive{/if}</button
		>{:else}<p>
			Ctrl/Cmd + clic pour ajouter ou retirer. Glisser sur le fond pour sélectionner une zone.
		</p>{/if}
	<div class="wb-row">
		<button type="button" onclick={all}
			><Icon name="phosphor:selection-all" /> Toutes les boîtes</button
		><button type="button" onclick={() => session.clearSelection()}
			><Icon name="phosphor:selection-slash" /> Vider</button
		>
	</div>
	<button type="button" disabled={session.selectionCount === 0} onclick={neighbors}
		><Icon name="phosphor:selection-plus" /> Étendre aux voisins / au contenu</button
	>
	<p>
		{session.selectionCount} élément(s) · Tab / flèches pour naviguer, Espace pour sélectionner, Échap
		pour vider.
	</p>
</div>
{#if box}<div
		class="selection-box"
		style:left={`${box.x}px`}
		style:top={`${box.y}px`}
		style:width={`${box.width}px`}
		style:height={`${box.height}px`}
	></div>{/if}

<style>
	.selection-box {
		pointer-events: none;
		position: fixed;
		border: 1px solid #6f70e8;
		background: #6f70e825;
		z-index: 50;
	}
</style>
