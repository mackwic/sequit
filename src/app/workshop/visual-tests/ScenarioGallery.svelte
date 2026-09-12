<script lang="ts">
	import { onMount } from 'svelte';

	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';

	import { catalogue } from '../../../../tests/scenarios/visual/catalogue';
	import { defined } from '../../../lib/core/document/logic-document';
	import {
		defaultVisualTestSettings,
		parseVisualTestSettings,
		type VisualTestSettings,
	} from './directions';
	import { scenarioPages } from './scenario-pages';

	const storageKey = 'sequit-visual-test-settings-v1';

	const cases = catalogue.map(({ scenario, documentPath }) => ({
		...scenario,
		loadPage: defined(
			scenarioPages[`/tests/scenarios/visual/${documentPath.slice(2)}`],
			`Missing scenario documentation: ${documentPath}`,
		),
	}));
	const initial = defined(cases.find(({ id }) => id === 'centered-chain') ?? cases[0]);
	const groups = [...new Set(cases.map((item) => item.group))];
	let selected = $derived(cases.find(({ id }) => id === page.params.scenario) ?? initial);

	function selectScenario(id: string, replaceState = false): void {
		if (page.params.scenario === id) return;
		void goto(resolve('/atelier/tests-visuels/[[scenario]]', { scenario: id }), {
			replaceState,
			noScroll: true,
			keepFocus: true,
		});
	}

	$effect(() => {
		if (page.params.scenario !== selected.id) selectScenario(selected.id, true);
	});
	let search = $state('');
	let matches = $derived(
		cases.filter((item) =>
			`${item.id} ${item.label} ${item.group}`
				.toLocaleLowerCase('fr')
				.includes(search.trim().toLocaleLowerCase('fr')),
		),
	);
	let settings = $state<VisualTestSettings>(defaultVisualTestSettings);
	let settingsLoaded = $state(false);

	onMount(() => {
		try {
			settings = parseVisualTestSettings(localStorage.getItem(storageKey));
		} catch {
			settings = defaultVisualTestSettings;
		} finally {
			settingsLoaded = true;
		}
	});

	$effect(() => {
		if (!settingsLoaded) return;
		try {
			localStorage.setItem(storageKey, JSON.stringify(settings));
		} catch {
			// The controls remain usable when browser storage is unavailable.
		}
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
										selectScenario(item.id);
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
		{#key selected.id}
			{#await selected.loadPage()}
				<p>Chargement du scénario…</p>
			{:then page}
				<page.default bind:settings />
			{:catch error}
				<p role="alert">Impossible de charger le scénario : {String(error)}</p>
			{/await}
		{/key}
	</article>
</div>
