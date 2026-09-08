<script lang="ts">
	import { LAYOUT_PERFORMANCE_NODE_COUNTS } from './fixtures/layout-performance/node-counts';
	import { LAYOUT_PERFORMANCE_SCENARIO_NAMES } from './fixtures/layout-performance/scenario-name';
	import { type WorkshopFixture, workshopFixtureLabels } from './runtime/workshop-fixture';

	let {
		fixture,
		disabled,
		onchange,
	}: {
		fixture: WorkshopFixture | null;
		disabled: boolean;
		onchange: (fixtureId: string, nodes: string) => void;
	} = $props();
	let chosen = $derived<string>(fixture?.id ?? 'parcours');
	let nodes = $derived.by(() => {
		if (fixture?.kind === 'performance') return String(fixture.nodeCount);
		return '50';
	});
	let stress = $derived(LAYOUT_PERFORMANCE_SCENARIO_NAMES.some((name) => name === chosen));
</script>

<form
	class="fixture-picker"
	aria-label="Configuration de l’atelier"
	onsubmit={(event) => {
		event.preventDefault();
		onchange(chosen, nodes);
	}}
>
	<div class="controls">
		<label
			>Document d’essai<select aria-label="Document d’essai" bind:value={chosen} {disabled}>
				<optgroup label="Documents d’exemple">
					<option value="simple">Simple · premières interactions</option>
					<option value="varied">Varié · page d’accueil</option>
				</optgroup>
				<optgroup label="Fixtures des tests de performance">
					{#each LAYOUT_PERFORMANCE_SCENARIO_NAMES as name (name)}
						<option value={name}>{workshopFixtureLabels[name]}</option>
					{/each}
				</optgroup>
				<optgroup label="Parcours guidés"
					><option value="parcours">Document propre au parcours</option></optgroup
				>
			</select></label
		>
		{#if stress}
			<label
				>Boîtes<select aria-label="Boîtes" bind:value={nodes} {disabled}>
					{#each LAYOUT_PERFORMANCE_NODE_COUNTS as count (count)}<option value={String(count)}
							>{count}</option
						>{/each}
				</select></label
			>{/if}
		<button type="submit" {disabled}>Charger le document</button>
	</div>
	{#if fixture}
		<p class="fixture-summary">
			<strong>{fixture.label} · {fixture.nodeCount} boîtes</strong> · {fixture.groups} groupes · {fixture.junctions}
			jonctions · {fixture.relations} relations
		</p>
		{#if fixture.kind === 'performance'}<p>
				Pour éprouver les repères, la navigation et les commandes sur des graphes plus grands.
			</p>
		{:else if fixture.id === 'simple'}<p>
				Le petit graphe initial : trois boîtes et deux relations pour découvrir chaque geste.
			</p>
		{:else}<p>
				Le document réel de la page d’accueil, avec ses différentes structures et natures.
			</p>{/if}
	{:else}
		<p>Le document préparé pour les consignes de ce parcours. Il change avec le scénario.</p>
	{/if}
	<p>
		Ce choix s’applique aux scénarios et aux variantes. Charger un document recommence l’essai ; les
		remarques sont conservées.
	</p>
</form>

<style>
	.fixture-picker {
		margin-bottom: 20px;
		padding: 12px 14px;
		background: #f0eeea;
		border-radius: 10px;
		font-size: 12px;
	}
	.controls {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		gap: 10px;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 5px;
		color: #57534e;
	}
	select,
	button {
		border: 1px solid var(--ui-border);
		border-radius: 6px;
		padding: 7px 9px;
		background: white;
		font: inherit;
	}
	button {
		cursor: pointer;
	}
	p {
		margin: 8px 0 0;
		color: #57534e;
		font-size: 11px;
		line-height: 1.5;
	}
	select:focus-visible,
	button:focus-visible {
		outline: 2px solid var(--ui-accent);
		outline-offset: 3px;
	}
</style>
