<script lang="ts">
	import { untrack } from 'svelte';

	import Icon from '../../web/ui/components/ui/Icon.svelte';
	import type { WorkbenchToolProps } from '../workshop-types';
	let { workbench, model, presentation, report }: WorkbenchToolProps = $props();
	const initial = untrack(() => {
		for (const node of model.nodes) {
			const sources = model.relations.filter(
				(edge) => edge.to === node.id && model.nodes.some((item) => item.id === edge.from),
			);
			if (sources[0] && sources[1]) return [sources[0].from, sources[1].from, node.id];
		}
		return [model.nodes[0]?.id, model.nodes[1]?.id, model.nodes.at(-1)?.id];
	});
	let first = $state(initial[0] ?? '');
	let second = $state(initial[1] ?? '');
	let target = $state(initial[2] ?? '');
	let proposed = $state(false);
	function create() {
		try {
			workbench.commands.createConvergence({
				id: `junction-${crypto.randomUUID()}`,
				first,
				second,
				target,
			});
			proposed = false;
			report(
				'Jonction XOR créée. Elle remplace les liens directs des deux sources vers cette cible.',
			);
		} catch (error) {
			report(String(error), true);
		}
	}
</script>

<div class="wb-tools">
	<h2>Une convergence explicite</h2>
	<p>
		Deux branches rejoignent une cible via une jonction XOR. Choisissez les extrémités avant de
		valider.
	</p>
	<label
		>Première branche<select bind:value={first}
			>{#each model.nodes as node (node.id)}<option value={node.id}>{node.markdown}</option
				>{/each}</select
		></label
	><label
		>Seconde branche<select bind:value={second}
			>{#each model.nodes as node (node.id)}<option value={node.id}>{node.markdown}</option
				>{/each}</select
		></label
	><label
		>Cible<select bind:value={target}
			>{#each model.nodes as node (node.id)}<option value={node.id}>{node.markdown}</option
				>{/each}</select
		></label
	>{#if presentation === 'assisted' && !proposed}<button
			type="button"
			onclick={() => {
				proposed = true;
			}}><Icon name="phosphor:git-merge" /> Proposer une convergence</button
		>{:else}{#if proposed}<p>Remplacer les deux liens directs par une jonction XOR ?</p>{/if}<button
			class="primary"
			type="button"
			onclick={create}><Icon name="phosphor:git-merge" /> Créer la jonction XOR</button
		><button
			type="button"
			onclick={() => {
				proposed = false;
			}}><Icon name="phosphor:x" /> Annuler</button
		>{/if}
</div>
