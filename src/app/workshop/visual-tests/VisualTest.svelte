<script lang="ts">
	import { tick, untrack } from 'svelte';

	import {
		type LayoutBias,
		layoutConfiguration,
		type LayoutDirection,
	} from '../../../lib/core/document/logic-document';
	import { VisualAssertionError } from './assertion-error';
	import {
		biasOptionsFor,
		defaultBiasFor,
		defaultVisualTestSettings,
		directionOptions,
		type VisualTestSettings,
	} from './directions';
	import {
		ExecutionStatus,
		initialExecutionState,
		ScenarioExecution,
	} from './execution/scenario-execution';
	import type { LayoutScenario } from './scenario';
	import ScenarioVerdict from './ScenarioVerdict.svelte';
	import SourceCode from './SourceCode.svelte';

	let {
		scenario,
		source,
		settings = $bindable(defaultVisualTestSettings),
	}: {
		scenario: LayoutScenario;
		source: string;
		settings?: VisualTestSettings;
	} = $props();
	let executionState = $state(initialExecutionState);
	const execution = new ScenarioExecution((state) => {
		executionState = state;
	});
	let layout = $derived(executionState.layout);
	let running = $derived(executionState.status === ExecutionStatus.Running);
	let failure = $derived.by(() => {
		if (executionState.status === ExecutionStatus.Failed)
			return { error: executionState.diagnostic };
		return null;
	});
	let targets = $derived.by(() => {
		const diagnostic = executionState.diagnostic;
		if (diagnostic instanceof VisualAssertionError) return diagnostic.targets;
		return {};
	});
	let simulated = $derived(executionState.simulated);
	const verdicts = {
		[ExecutionStatus.Idle]: 'Pas encore exécuté',
		[ExecutionStatus.Running]: 'Exécution…',
		[ExecutionStatus.Passed]: 'Réussi · toutes les assertions passent',
		[ExecutionStatus.Failed]: 'Échec du scénario',
	};
	let verdict = $derived(verdicts[executionState.status]);
	let layoutDirection = $derived(settings.direction);
	let layoutBias = $derived(settings.bias);
	let open = $state(true);
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
		settings = { ...settings, direction, bias };
	}
	function setBias(bias: LayoutBias) {
		scrollRequested = true;
		settings = { ...settings, bias };
	}
	function setGuides(guides: boolean) {
		settings = { ...settings, guides };
	}

	// Guide visibility is a view preference; only layout inputs trigger execution.
	$effect(() => {
		const configuration = { direction: layoutDirection, bias: layoutBias };
		const currentScenario = scenario;
		untrack(() => {
			void execution.run(currentScenario, configuration);
		});
		return () => {
			execution.cancel();
		};
	});
</script>

<section class="visual-test" aria-label="Test exécutable">
	<div class="test-code">
		<div class="block-heading">
			<strong>01 / Code exécuté</strong><span>TypeScript · source unique</span>
		</div>
		<SourceCode {source} />
		<ScenarioVerdict {verdict} {failure} />
	</div>
	<details
		class="visual-control"
		bind:open
		ontoggle={(event) => {
			if (event.currentTarget.open) void execution.run(scenario, settings);
		}}
	>
		<summary>02 / Contrôle visuel optionnel</summary>
		{#if open}
			{#if layout !== null}
				{#if simulated}<p class="simulation-note">
						Simulation de diagnostic : le résultat a été modifié localement. Le scénario enregistré
						reste intact. Réexécute-le pour retrouver le résultat du moteur.
					</p>{/if}
				{#await import('./LayoutPreview.svelte') then preview}<div use:revealPreview>
						{#if layout.reference}
							<h3>{layout.reference.label}</h3>
							<preview.default layout={layout.reference.layout} guides={settings.guides} />
							<h3>Situation à vérifier</h3>
						{/if}
						<preview.default {layout} guides={settings.guides} {targets} />
					</div>{/await}
			{:else if running}<p class="preview-empty">Calcul du layout…</p>{/if}
			<div class="visual-settings" role="group" aria-label="Réglages du contrôle visuel">
				<div class="execution-bar">
					<label class="scenario-direction"
						>Direction<select
							bind:value={() => settings.direction, setDirection}
							disabled={running}
						>
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
					<button
						type="button"
						class="execute"
						onclick={() => execution.run(scenario, settings)}
						disabled={running}
					>
						{#if running}Exécution…{:else}Réexécuter le scénario{/if}
					</button>
				</div>
				{#if layout !== null}
					<div class="preview-controls">
						<label
							><input type="checkbox" bind:checked={() => settings.guides, setGuides} /> Afficher les
							centres et coordonnées</label
						>
						{#if scenario.simulation}<button
								type="button"
								onclick={() => {
									execution.simulate();
								}}
								disabled={running || simulated}>{scenario.simulation.label}</button
							>{/if}
					</div>
				{/if}
			</div>
		{/if}
	</details>
</section>
