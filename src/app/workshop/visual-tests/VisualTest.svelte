<script lang="ts">
	import { untrack } from 'svelte';

	import { defaultVisualTestSettings, type VisualTestSettings as Settings } from './directions';
	import { presentExecution } from './execution/present-execution';
	import {
		ExecutionStatus,
		initialExecutionState,
		ScenarioExecution,
	} from './execution/scenario-execution';
	import type { LayoutScenario } from './scenario';
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
		<ScenarioVerdict verdict={presentation.verdict} failure={presentation.failure} />
	</div>
	<details class="visual-control" bind:open>
		<summary>02 / Contrôle visuel</summary>
		{#if open}
			{#if layout !== null}
				{#await import('./LayoutPreview.svelte') then preview}<div>
						{#if layout.reference}
							<h3>{layout.reference.label}</h3>
							<preview.default layout={layout.reference.layout} guides={settings.guides} />
							<h3>Situation à vérifier</h3>
						{/if}
						<preview.default {layout} guides={settings.guides} targets={presentation.targets} />
					</div>{/await}
			{:else if running}<p class="preview-empty">Calcul du layout…</p>{/if}
			<VisualTestSettings
				bind:settings
				{running}
				hasLayout={layout !== null}
				onrun={() => {
					void execution.run(scenario, settings);
				}}
			/>
		{/if}
	</details>
</section>
