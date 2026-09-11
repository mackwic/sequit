<script lang="ts">
	import { tick, untrack } from 'svelte';

	import {
		LayoutBias,
		layoutConfiguration,
		LayoutDirection,
	} from '../../../lib/core/document/logic-document';
	import {
		biasOptionsFor,
		defaultBiasFor,
		directionOptions,
		type VisualTestSettings,
	} from './directions';
	import type { LayoutScenario } from './scenario';
	import SourceCode from './SourceCode.svelte';
	import type { VisualLayout } from './visual-layout';

	let {
		scenario,
		source,
		settings = $bindable({ direction: LayoutDirection.TopToBottom, bias: LayoutBias.Top }),
	}: {
		scenario: LayoutScenario;
		source: string;
		settings?: VisualTestSettings;
	} = $props();
	let layout = $state<VisualLayout | null>(null);
	let running = $state(false);
	let verdict = $state('Pas encore exécuté');
	let failure = $state(false);
	let open = $state(true);
	let guides = $state(true);
	let simulated = $state(false);
	let scrollRequested = false;

	function revealPreview(node: HTMLElement) {
		if (!scrollRequested) return;
		scrollRequested = false;
		void tick().then(() => {
			if (node.isConnected) node.scrollIntoView({ block: 'end' });
		});
	}

	function setDirection(direction: LayoutDirection) {
		scrollRequested = true;
		let bias = settings.bias;
		if (layoutConfiguration(direction, bias) === undefined) bias = defaultBiasFor(direction);
		settings = { direction, bias };
	}
	function setBias(bias: LayoutBias) {
		scrollRequested = true;
		settings = { ...settings, bias };
	}

	// Runs on mount and layout setting changes, without subscribing to execution state.
	$effect(() => {
		const configuration = settings;
		untrack(() => {
			void run(configuration);
		});
	});

	function check() {
		if (layout === null) return;
		try {
			scenario.assert(layout);
			failure = false;
			verdict = 'Réussi · toutes les assertions passent';
		} catch (error) {
			failure = true;
			verdict = String(error);
		}
	}
	async function run({ direction, bias }: VisualTestSettings) {
		if (running) return;
		running = true;
		layout = null;
		simulated = false;
		failure = false;
		verdict = 'Exécution…';
		try {
			layout = await scenario.arrange(direction, bias);
			check();
		} catch (error) {
			failure = true;
			verdict = String(error);
		} finally {
			running = false;
		}
	}
	function simulate() {
		if (layout === null || scenario.simulation === undefined) return;
		layout = scenario.simulation.apply(layout);
		simulated = true;
		check();
	}
</script>

<section class="visual-test" aria-label="Test exécutable">
	<div class="test-code">
		<div class="block-heading">
			<strong>01 / Code exécuté</strong><span>TypeScript · source unique</span>
		</div>
		<SourceCode {source} />
		<p role="status" class="scenario-verdict" class:failure>{verdict}</p>
	</div>
	<details
		class="visual-control"
		bind:open
		ontoggle={(event) => {
			if (event.currentTarget.open) void run(settings);
		}}
	>
		<summary>02 / Contrôle visuel optionnel</summary>
		{#if open}
			<div class="execution-bar">
				<label class="scenario-direction"
					>Direction<select bind:value={() => settings.direction, setDirection} disabled={running}>
						{#each directionOptions as option (option.value)}
							<option value={option.value}>{option.label}</option>
						{/each}
					</select></label
				>
				<label class="scenario-direction"
					>Bias<select bind:value={() => settings.bias, setBias} disabled={running}>
						{#each biasOptionsFor(settings.direction) as option (option.value)}
							<option value={option.value}>{option.label}</option>
						{/each}
					</select></label
				>
				<button type="button" class="execute" onclick={() => run(settings)} disabled={running}>
					{#if running}Exécution…{:else}Réexécuter le scénario{/if}
				</button>
			</div>
			{#if layout !== null}
				<div class="preview-controls">
					<label
						><input type="checkbox" bind:checked={guides} /> Afficher les centres et coordonnées</label
					>
					{#if scenario.simulation}<button
							type="button"
							onclick={simulate}
							disabled={running || simulated}>{scenario.simulation.label}</button
						>{/if}
				</div>
				{#if simulated}<p class="simulation-note">
						Simulation de diagnostic : le résultat a été modifié localement. Le scénario enregistré
						reste intact. Réexécute-le pour retrouver le résultat du moteur.
					</p>{/if}
				{#await import('./LayoutPreview.svelte') then preview}<div use:revealPreview>
						<preview.default {layout} {guides} />
					</div>{/await}
			{:else if running}<p class="preview-empty">Calcul du layout…</p>{/if}
		{/if}
	</details>
</section>
