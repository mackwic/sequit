<script lang="ts">
	import { tick } from 'svelte';

	import { EntityKind, entityRef } from '../../web/ui/canvas/canvas-entity';
	import { MIN_CANVAS_ZOOM } from '../../web/ui/canvas/canvas-viewport';
	import Icon from '../../web/ui/components/ui/Icon.svelte';
	import type { WorkbenchToolProps } from '../workshop-types';
	let { model, session, viewport, canvas, presentation, report }: WorkbenchToolProps = $props();
	let query = $state('');
	let results = $derived(
		model.nodes.filter((node) => node.markdown.toLowerCase().includes(query.toLowerCase())),
	);
	async function locate(id: string) {
		session.selectEntity(entityRef(EntityKind.Node, id));
		await tick();
		const node = viewport?.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(id)}"]`);
		if (viewport && node) {
			viewport.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
			const area = viewport.getBoundingClientRect(),
				bounds = node.getBoundingClientRect();
			let behavior: ScrollBehavior = 'smooth';
			if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) behavior = 'instant';
			viewport.scrollBy({
				left: bounds.x + bounds.width / 2 - area.x - area.width / 2,
				top: bounds.y + bounds.height / 2 - area.y - area.height / 2,
				behavior,
			});
			node.focus({ preventScroll: true });
		}
		report('Boîte retrouvée et sélectionnée.');
	}
	async function frame(selection = false) {
		if (!canvas || !viewport) return;
		if (selection) {
			const ref = [...session.selection.values()][0];
			if (ref) await locate(ref.id);
			return;
		}
		session.zoom = Math.min(
			1,
			Math.max(
				MIN_CANVAS_ZOOM,
				Math.min(
					(viewport.clientWidth - 140) / canvas.width,
					(viewport.clientHeight - 140) / canvas.height,
				),
			),
		);
		await tick();
		viewport.scrollTo({ left: 0, top: 0 });
		if (
			canvas.width * session.zoom + 140 > viewport.clientWidth ||
			canvas.height * session.zoom + 140 > viewport.clientHeight
		)
			report(
				'Zoom minimal atteint : une partie du graphe reste hors champ. Utilisez la recherche pour rejoindre une boîte.',
			);
		else report('Vue d’ensemble · utilisez la recherche pour rejoindre une boîte.');
	}
</script>

<div class="wb-tools">
	<h2>Explorer</h2>
	<div class="wb-row">
		<button type="button" onclick={() => void frame()}
			><Icon name="phosphor:arrows-out" /> Tout cadrer</button
		><button type="button" disabled={session.selectionCount === 0} onclick={() => void frame(true)}
			><Icon name="phosphor:scan" /> Voir la sélection</button
		>
	</div>
	<label>Rechercher une boîte<input bind:value={query} placeholder="Décision, option…" /></label>
	<div class="wb-list">
		{#each results as node (node.id)}<button type="button" onclick={() => void locate(node.id)}
				>{node.markdown}</button
			>{/each}
	</div>
	{#if results.length === 0}<p>Aucune boîte trouvée.</p>{/if}
	<p>Espace + glisser pour déplacer la vue. Ctrl/Cmd + molette pour zoomer.</p>
</div>
{#if presentation === 'minimap' && canvas}
	<div class="minimap" aria-label="Mini-carte">
		{#each canvas.nodes as node (node.id)}<button
				type="button"
				aria-label={`Rejoindre ${node.markdown}`}
				title={node.markdown}
				style:left={`${(node.bounds.x / canvas.width) * 170 + 5}px`}
				style:top={`${(node.bounds.y / canvas.height) * 95 + 5}px`}
				style:width={`${Math.max(8, (node.bounds.width / canvas.width) * 170)}px`}
				style:height={`${Math.max(5, (node.bounds.height / canvas.height) * 95)}px`}
				onclick={() => void locate(node.id)}
			></button>{/each}
	</div>{/if}

<style>
	.minimap {
		position: absolute;
		right: 12px;
		top: 12px;
		width: 180px;
		height: 110px;
		border: 1px solid #ccc5bb;
		border-radius: 8px;
		background: #fffdf6;
		z-index: 34;
		box-shadow: 0 4px 20px #0001;
	}
	.minimap button {
		position: absolute;
		background: #a6a0df;
		border: 1px solid #6f70e8;
		border-radius: 3px;
		cursor: pointer;
	}
	.minimap button:focus-visible {
		outline: 2px solid black;
		outline-offset: 2px;
	}
</style>
