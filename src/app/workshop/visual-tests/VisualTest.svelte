<script lang="ts">
	import { untrack } from 'svelte';

	import type { LayoutScenario } from '../../../../tests/scenarios/visual/scenario';
	import { defaultVisualTestSettings, type VisualTestSettings as Settings } from './directions';
	import { presentExecution } from './execution/present-execution';
	import {
		ExecutionStatus,
		initialExecutionState,
		ScenarioExecution,
	} from './execution/scenario-execution';
	import ScenarioVerdict from './ScenarioVerdict.svelte';
	import SourceCode from './SourceCode.svelte';
	import VisualTestSettings from './VisualTestSettings.svelte';

	let {
		scenario,
		source,
		settings = $bindable(defaultVisualTestSettings),
	}: {
		scenario: LayoutScenario;
		source: string;
		settings?: Settings;
	} = $props();
	let variantId = $state('');
	const activeScenario = $derived(
		scenario.variants?.find(({ id }) => id === variantId) ?? scenario.variants?.[0] ?? scenario,
	);
	let executionState = $state(initialExecutionState);
	const execution = new ScenarioExecution((state) => {
		executionState = state;
	});
	let layout = $derived(executionState.layout);
	let running = $derived(executionState.status === ExecutionStatus.Running);
	let presentation = $derived(presentExecution(executionState));
	let layoutDirection = $derived(settings.direction);
	let layoutBias = $derived(settings.bias);
	let open = $state(true);
	// Guide visibility is a view preference; only layout inputs trigger execution.
	$effect(() => {
		const configuration = { direction: layoutDirection, bias: layoutBias };
		const currentScenario = activeScenario;
		untrack(() => {
			void execution.run(currentScenario, configuration);
		});
		return () => {
			execution.cancel();
		};
	});
</script>

<section class="visual-test" aria-label="Test exécutable" data-scenario-id={activeScenario.id}>
	{#if scenario.variants}
		<div class="variant-controls">
			<label class="variant-picker"
				>Variante
				<select
					value={activeScenario.id}
					onchange={(event) => {
						variantId = event.currentTarget.value;
					}}
				>
					{#each scenario.variants as variant (variant.id)}<option value={variant.id}
							>{variant.label}</option
						>{/each}
				</select>
			</label>
			{#if activeScenario.description}<p class="variant-description">
					{activeScenario.description}
				</p>{/if}
		</div>
	{/if}
	<div class="test-code">
		<div class="block-heading">
			<strong>01 / Code exécuté</strong><span>TypeScript · source unique</span>
		</div>
		<SourceCode {source} />
		<ScenarioVerdict verdict={presentation.verdict} failure={presentation.failure} />
	</div>
	<details class="visual-control" bind:open>
		<summary>02 / Contrôle visuel</summary>
		{#if open}
			{#if layout !== null}
				{#await import('./LayoutPreview.svelte') then preview}<div>
						{#if layout.reference}
							<h3>{layout.reference.label}</h3>
							<preview.default
								layout={layout.reference.layout}
								guides={settings.guides}
								reservations={settings.reservations}
							/>
							<h3>Situation à vérifier</h3>
						{/if}
						<preview.default
							{layout}
							guides={settings.guides}
							reservations={settings.reservations}
							targets={presentation.targets}
						/>
					</div>{/await}
			{:else if running}<p class="preview-empty">Calcul du layout…</p>{/if}
			<VisualTestSettings
				bind:settings
				{running}
				hasLayout={layout !== null}
				onrun={() => {
					void execution.run(activeScenario, settings);
				}}
			/>
		{/if}
	</details>
</section>

<style>
	.variant-controls {
		padding: 1rem 1.4rem;
		border-bottom: 1px solid #dfe5d8;
	}

	.variant-picker {
		display: grid;
		gap: 0.4rem;
		margin-bottom: 1rem;
		font-weight: 600;
	}
	select {
		width: 100%;
		padding: 0.65rem;
		border: 1px solid #c8cec2;
		border-radius: 0.5rem;
		background: white;
		color: inherit;
		font: inherit;
	}
	.variant-description {
		margin: 0;
	}
</style>
