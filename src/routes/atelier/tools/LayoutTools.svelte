<script lang="ts">
	import { untrack } from 'svelte';

	import Icon from '$lib/components/ui/Icon.svelte';
	import { defined, LAYOUT_DIRECTIONS, LayoutDirection } from '$lib/document/logic-document';

	import type { WorkbenchToolProps } from '../workshop-types';
	let { model, workbench, view, setView, presentation, report }: WorkbenchToolProps = $props();
	// A pending form belongs to its document revision. Undo/import invalidates it.
	let draft = $state<{ baseline: typeof model; direction: LayoutDirection; spacing: number }>();
	let pending = $derived.by(() => {
		if (draft?.baseline === model) return draft;
		return undefined;
	});
	let direction = $derived(pending?.direction ?? model.layout.direction);
	let spacing = $derived(pending?.spacing ?? view.spacing);
	let first = $state(untrack(() => model.nodes[0]?.id ?? ''));
	function apply() {
		try {
			const nextSpacing = spacing;
			workbench.commands.arrange(direction);
			setView({ spacing: nextSpacing });
			draft = undefined;
			report('Disposition appliquée. L’espacement reste une préférence de cette vue.');
		} catch (error) {
			report(String(error), true);
		}
	}
	function changeDirection(input: string) {
		const value = defined(LAYOUT_DIRECTIONS.find((direction: string) => direction === input));
		if (presentation === 'live') {
			try {
				workbench.commands.arrange(value);
			} catch (error) {
				report(String(error), true);
			}
		} else draft = { baseline: model, direction: value, spacing };
	}
	function changeSpacing(value: number) {
		if (presentation === 'live') setView({ spacing: value });
		else draft = { baseline: model, direction, spacing: value };
	}

	function reorder() {
		try {
			workbench.commands.placeNodeFirst(first);
			report('Ordre ajusté parmi les boîtes de même rang. Les dépendances gardent leur priorité.');
		} catch (error) {
			report(String(error), true);
		}
	}
</script>

<div class="wb-tools">
	<h2>Disposer le graphe</h2>
	<label
		>Sens de lecture<select
			value={direction}
			onchange={(event) => {
				changeDirection(event.currentTarget.value);
			}}
		>
			<option value={LayoutDirection.TopToBottom}>De haut en bas</option><option
				value={LayoutDirection.BottomToTop}>De bas en haut</option
			><option value={LayoutDirection.LeftToRight}>De gauche à droite</option><option
				value={LayoutDirection.RightToLeft}>De droite à gauche</option
			>
		</select></label
	>
	<label
		>Espacement<select
			value={spacing}
			onchange={(event) => {
				changeSpacing(Number(event.currentTarget.value));
			}}
			><option value={1}>Normal</option><option value={1.35}>Aéré</option><option value={1.7}
				>Très aéré</option
			></select
		></label
	>
	{#if presentation === 'apply'}<p>Prépare les réglages, puis compare le résultat.</p>
		<button class="primary" type="button" onclick={apply}
			><Icon name="phosphor:check" /> Appliquer la disposition</button
		>{:else}<p>Chaque réglage est appliqué immédiatement.</p>{/if}
	<label
		>Boîte à placer en premier<select bind:value={first}
			>{#each model.nodes as node (node.id)}<option value={node.id}>{node.markdown}</option
				>{/each}</select
		></label
	>
	<button type="button" onclick={reorder}
		><Icon name="phosphor:arrow-line-up" /> Placer en premier dans son rang</button
	>
</div>
