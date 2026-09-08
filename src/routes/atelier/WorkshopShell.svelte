<script lang="ts">
	import { onMount } from 'svelte';

	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { navigating, page } from '$app/state';
	import Icon from '$lib/components/ui/Icon.svelte';

	import type { WorkshopFixture } from './runtime/workshop-fixture';
	import type { WorkshopGroup } from './workshop-types';
	import WorkshopFeedback from './WorkshopFeedback.svelte';
	import WorkshopFixturePicker from './WorkshopFixturePicker.svelte';
	let {
		groups,
		fixture,
	}: { groups: readonly [WorkshopGroup, ...WorkshopGroup[]]; fixture: WorkshopFixture | null } =
		$props();
	let selected = $derived.by(() => {
		for (const group of groups) {
			const scenario = group.scenarios.find(
				(item) => item.id === page.url.searchParams.get('scenario'),
			);
			if (scenario) return { group, scenario };
		}
		return { group: groups[0], scenario: groups[0].scenarios[0] };
	});
	let group = $derived(selected.group);
	let scenario = $derived(selected.scenario);
	let active = $derived(
		scenario.variants.find((item) => item.id === page.url.searchParams.get('variant')) ??
			scenario.variants[0],
	);
	let instruction = $derived.by(() => {
		if (fixture && scenario.fixtureInstruction)
			return scenario.fixtureInstruction(fixture.nodeCount);
		return scenario.instruction;
	});
	let documentKey = $derived.by(() => {
		if (!fixture) return 'document-du-parcours';
		return `${fixture.id}-${fixture.nodeCount}`;
	});
	let initialState = $derived.by(() => {
		if (fixture?.id === 'simple') return { zoom: 1, selection: [] };
		if (fixture) return { zoom: 0.7, selection: [] };
		return scenario.initialState;
	});
	let trial = $derived(`${active.id} / ${documentKey}`);
	let iteration = $state(0);
	let ready = $state(false);
	onMount(() => {
		ready = true;
	});
	function changeFixture(fixtureId: string, nodes: string) {
		const url = new URL(page.url);
		url.searchParams.delete('fixture');
		url.searchParams.delete('nodes');
		if (fixtureId) {
			url.searchParams.set('fixture', fixtureId);
			if (fixtureId !== 'simple' && fixtureId !== 'varied' && fixtureId !== 'parcours')
				url.searchParams.set('nodes', nodes);
		}
		if (url.search === page.url.search) return;
		void goto(resolve(`/atelier?${url.searchParams.toString()}`), {
			noScroll: true,
			keepFocus: true,
		});
	}
	function navigate(scenarioId: string, variantId: string) {
		if (scenario.id === scenarioId && active.id === variantId) return;
		const url = new URL(page.url);
		url.searchParams.set('scenario', scenarioId);
		url.searchParams.set('variant', variantId);
		void goto(resolve(`/atelier?${url.searchParams.toString()}`), {
			noScroll: true,
			keepFocus: true,
		});
	}
</script>

<svelte:head
	><title>Sequit — Atelier d’interactions</title><meta
		name="robots"
		content="noindex"
	/></svelte:head
>
<main>
	<aside>
		<a class="brand" href={resolve('/')}
			>S<span>Sequit <small>Atelier d’interactions</small></span></a
		>
		<p class="eyebrow">01 / Parcours à explorer</p>
		<nav class="scenarios" aria-label="Scénarios">
			{#each groups as item (item.id)}
				<div class="group">{item.id} <span>{item.label}</span></div>
				{#each item.scenarios as entry (entry.id)}
					<button
						type="button"
						class="scenario"
						class:chosen={scenario.id === entry.id}
						aria-pressed={scenario.id === entry.id}
						disabled={!ready}
						onclick={() => {
							navigate(entry.id, entry.variants[0].id);
						}}
					>
						<code>{entry.id}</code><strong>{entry.label}</strong><span>{entry.journey}</span>
					</button>
				{/each}{/each}
		</nav>
		<p class="local">
			Document d’essai local.<br />Les modifications sont effacées au changement de variante ou au
			redémarrage.
		</p>
	</aside>
	<section class="workspace">
		<WorkshopFixturePicker
			{fixture}
			disabled={!ready || navigating.to !== null}
			onchange={changeFixture}
		/>
		<header>
			<div>
				<p class="eyebrow">Atelier / {group.id} / {scenario.id}</p>
				<h1>{scenario.title}</h1>
				<p class="subtitle">{scenario.subtitle}</p>
			</div>
			<span class="badge">En discussion</span>
		</header>
		<nav class="variants" aria-label="Variantes">
			{#each scenario.variants as variant (variant.id)}<button
					type="button"
					disabled={!ready}
					class:active={active.id === variant.id}
					aria-pressed={active.id === variant.id}
					onclick={() => {
						navigate(scenario.id, variant.id);
					}}><small>{variant.tag}</small><strong>{variant.label}</strong></button
				>{/each}
		</nav>

		<div class="brief">
			<div>
				<strong>À essayer</strong>
				<p>{instruction}</p>
				<small class="reset-hint"
					>Chaque variante repart du document d’essai. Tes remarques sont conservées.</small
				>
			</div>
			<button
				type="button"
				disabled={!ready}
				onclick={() => {
					iteration += 1;
				}}><Icon name="phosphor:arrow-counter-clockwise" /> Recommencer</button
			>
		</div>
		<div class="stage" inert={!ready}>
			{#if fixture?.problem}<div class="fixture-problem" role="alert">
					<strong>Ce document dépasse les limites actuelles du graphe.</strong>
					<p>{fixture.problem}</p>
					<p>
						Choisis une taille plus petite ou une autre forme de graphe. Tu peux noter cette limite
						dans le bilan.
					</p>
				</div>{:else}
				{#key `${scenario.id}-${active.id}-${documentKey}-${iteration}`}<active.scene
						source={fixture?.source ?? scenario.source}
						{initialState}
						tools={active.tools}
						presentation={active.presentation}
						frame={active.frame}
					/>{/key}{/if}
		</div>
		<footer>
			<div>
				<a
					href={resolve(
						`/atelier?${new URLSearchParams({ scenario: scenario.id, variant: active.id, fixture: fixture?.id ?? 'parcours', ...(fixture?.kind === 'performance' && { nodes: String(fixture.nodeCount) }) }).toString()}`,
					)}
					title="Lien direct vers cette variante"><code>{scenario.id} / {active.id}</code></a
				>
				<p>{active.description}</p>
			</div>
			<div>
				<strong>À discuter ensemble</strong>
				<p>{active.question}</p>
			</div>
		</footer>
		<WorkshopFeedback {scenario} {trial} scenarios={groups.flatMap((item) => item.scenarios)} />
	</section>
</main>

<style>
	:global(body) {
		margin: 0;
	}
	main {
		height: 100dvh;
		min-height: 720px;
		background: var(--ui-bg);
		color: var(--ui-text);
		display: grid;
		grid-template-columns: 240px minmax(0, 1fr);
		font-family: Arial, sans-serif;
	}
	aside {
		border-right: 1px solid var(--ui-border);
		padding: 24px 16px;
		min-height: 0;
		overflow: auto;
		display: flex;
		flex-direction: column;
	}
	.brand {
		display: flex;
		align-items: center;
		gap: 12px;
		font-weight: 700;
		font-size: 24px;
		text-decoration: none;
		color: inherit;
	}
	.brand span {
		font-size: 17px;
	}
	.brand small {
		display: block;
		font-size: 11px;
		font-weight: 400;
		color: var(--ui-muted);
		margin-top: 4px;
	}
	.eyebrow {
		font-size: 10px;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--ui-muted);
		margin: 0 0 12px;
	}
	aside .eyebrow {
		margin-top: 24px;
	}
	.group {
		font: 12px monospace;
		color: var(--ui-muted);
	}
	.group span {
		margin-left: 12px;
		color: var(--ui-text);
		font: 600 13px Arial;
	}
	.scenarios {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.scenario.chosen {
		border-left-color: var(--ui-accent);
		background: #eeeae3;
	}
	.scenario {
		text-align: left;
		width: 100%;
		margin-top: 0;
		padding: 10px;
		background: transparent;
		border-radius: 10px;
		display: flex;
		flex-direction: column;
		gap: 5px;
		border-left: 3px solid transparent;
	}
	code {
		font-size: 11px;
		color: #6f70a8;
	}
	.scenario strong {
		font-size: 12px;
	}
	.scenario span {
		font-size: 11px;
		color: var(--ui-muted);
	}
	.local {
		margin-top: auto;
		padding-top: 40px;
		font-size: 11px;
		line-height: 1.7;
		color: var(--ui-muted);
	}
	.workspace {
		min-height: 0;
		overflow: auto;
		padding: 32px 36px 20px;
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	header {
		display: flex;
		justify-content: space-between;
		gap: 16px;
		align-items: flex-start;
	}
	h1 {
		font-size: 30px;
		letter-spacing: -1px;
		margin: 0;
		font-weight: 600;
	}
	.subtitle {
		font-size: 13px;
		color: var(--ui-muted);
		margin: 10px 0 24px;
	}
	.badge {
		font-size: 10px;
		border: 1px solid var(--ui-border);
		padding: 7px 10px;
		border-radius: 20px;
		white-space: nowrap;
	}
	.variants {
		display: flex;
		gap: 8px;
	}
	.variants button {
		flex: 1;
		text-align: left;
		border: 1px solid var(--ui-border);
		border-radius: 10px;
		padding: 13px 16px;
		background: #fff;
	}
	.variants small {
		display: block;
		color: var(--ui-muted);
		font-size: 10px;
		margin-bottom: 5px;
	}
	.variants strong {
		font-size: 13px;
		font-weight: 500;
	}
	.variants .active {
		border-color: var(--ui-accent);
		background: var(--ui-accent-soft);
		box-shadow: inset 0 0 0 1px var(--ui-accent);
	}
	.reset-hint {
		font-size: 11px;
		color: var(--ui-muted);
	}
	.brief {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 18px;
		padding: 20px 0 15px;
		font-size: 12px;
	}
	.brief p {
		margin: 6px 0 0;
		color: var(--ui-muted);
		line-height: 1.5;
	}
	.brief button {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		white-space: nowrap;
		border: 1px solid var(--ui-border);
		border-radius: 6px;
		padding: 8px 12px;
		background: white;
		font-size: 11px;
	}
	.fixture-problem {
		padding: 24px;
		font-size: 14px;
		line-height: 1.6;
	}
	.stage {
		flex: 1;
		min-height: 560px;
		flex-shrink: 0;
		border: 1px solid var(--ui-border);
		border-radius: 12px;
		overflow: hidden;
		position: relative;
		background: var(--ui-subtle);
	}
	footer {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 30px;
		padding-top: 18px;
		font-size: 12px;
	}
	footer strong {
		font-size: 11px;
	}
	footer p {
		color: var(--ui-muted);
		line-height: 1.6;
		margin: 7px 0 0;
	}
	button {
		cursor: pointer;
	}
	button:focus-visible,
	a:focus-visible {
		outline: 2px solid var(--ui-accent);
		outline-offset: 4px;
	}
	@media (max-width: 900px) {
		.stage:has(:global(.workbench)) {
			min-height: 850px;
		}
		main {
			grid-template-columns: 1fr;
		}
		aside {
			padding: 12px 20px;
		}
		.brand,
		aside .eyebrow,
		.local {
			display: none;
		}
		.scenarios {
			flex-direction: row;
			flex-wrap: nowrap;
			overflow: auto;
			max-height: 130px;
		}
		.scenario {
			width: 180px;
			flex-shrink: 0;
			margin: 0;
			padding: 8px;
		}
		.scenario span,
		.group {
			display: none;
		}
		.workspace {
			padding: 20px;
		}
		h1 {
			font-size: 25px;
		}
		footer {
			grid-template-columns: 1fr;
			gap: 12px;
		}
	}
	@media (max-width: 500px) {
		.workspace {
			padding: 12px;
		}
		.variants button {
			padding: 10px;
		}
		header .badge {
			display: none;
		}
		.reset-hint {
			font-size: 11px;
			color: var(--ui-muted);
		}
		.brief {
			align-items: flex-start;
		}
		.stage {
			min-height: 520px;
		}
	}
</style>
