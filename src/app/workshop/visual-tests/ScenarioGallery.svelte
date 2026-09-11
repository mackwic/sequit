<script lang="ts">
	import { LayoutBias, LayoutDirection } from '../../../lib/core/document/logic-document';
	import CenteredChain from './centered-chain.svx';
	import DirectedChain from './directed-chain.svx';
	import type { VisualTestSettings } from './directions';
	import IndependentNodes from './independent-nodes.svx';
	import SingleNode from './single-node.svx';

	const initial = {
		id: 'centered-chain',
		label: 'Tailles différentes',
		group: 'Centrage et alignement',
		page: CenteredChain,
	};
	const cases = [
		{ id: 'single-node', label: 'Un nœud', group: 'Centrage et alignement', page: SingleNode },
		initial,
		{
			id: 'independent-nodes',
			label: 'Deux nœuds sans lien',
			group: 'Rangs et progression',
			page: IndependentNodes,
		},
		{ id: 'directed-chain', label: 'A → B', group: 'Rangs et progression', page: DirectedChain },
	];
	const groups = [...new Set(cases.map((item) => item.group))];
	let selected = $state(initial);
	let search = $state('');
	let matches = $derived(
		cases.filter((item) =>
			`${item.id} ${item.label} ${item.group}`
				.toLocaleLowerCase('fr')
				.includes(search.trim().toLocaleLowerCase('fr')),
		),
	);
	let settings = $state<VisualTestSettings>({
		direction: LayoutDirection.TopToBottom,
		bias: LayoutBias.Top,
	});
</script>

<div class="scenario-gallery">
	<nav class="scenario-tree" aria-label="Scénarios d’assertions visuelles">
		<label class="scenario-search"
			>Rechercher un scénario
			<input type="search" bind:value={search} placeholder="Nom, identifiant, groupe…" />
		</label>
		<p class="scenario-count">{matches.length} / {cases.length} scénarios</p>
		{#each groups as group (group)}
			{@const items = matches.filter((item) => item.group === group)}
			{#if items.length > 0}
				<details open class="scenario-group">
					<summary>{group} <span>{items.length}</span></summary>
					<ul>
						{#each items as item (item.id)}
							<li>
								<button
									type="button"
									class:active={selected.id === item.id}
									aria-pressed={selected.id === item.id}
									aria-label={item.label}
									onclick={() => {
										selected = item;
									}}
								>
									<span>{item.label}</span><code>{item.id}</code>
								</button>
							</li>
						{/each}
					</ul>
				</details>
			{/if}
		{/each}
		{#if matches.length === 0}<p>Aucun scénario trouvé.</p>{/if}
	</nav>
	<article class="scenario-content">
		<div class="scenario-identity" aria-label="Identité du test">
			<span>Test <code>{selected.id}</code></span>
			<span>Groupe · {selected.group}</span>
		</div>
		{#key selected.id}<selected.page bind:settings />{/key}
	</article>
</div>
