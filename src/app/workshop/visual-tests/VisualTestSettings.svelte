<script lang="ts">
	import {
		type LayoutBias,
		layoutConfiguration,
		type LayoutDirection,
	} from '../../../lib/core/document/logic-document';
	import {
		biasOptionsFor,
		defaultBiasFor,
		defaultVisualTestSettings,
		directionOptions,
		type VisualTestSettings,
	} from './directions';

	let {
		settings = $bindable(defaultVisualTestSettings),
		running,
		hasLayout,
		onrun,
	}: {
		settings?: VisualTestSettings;
		running: boolean;
		hasLayout: boolean;
		onrun: () => void;
	} = $props();
	function setDirection(direction: LayoutDirection) {
		let bias = settings.bias;
		if (layoutConfiguration(direction, bias) === undefined) bias = defaultBiasFor(direction);
		settings = { ...settings, direction, bias };
	}
	function setBias(bias: LayoutBias) {
		settings = { ...settings, bias };
	}
	function setGuides(guides: boolean) {
		settings = { ...settings, guides };
	}
</script>

<div class="visual-settings" role="group" aria-label="Réglages du contrôle visuel">
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
		<button type="button" class="execute" onclick={onrun} disabled={running}>
			{#if running}Exécution…{:else}Réexécuter le scénario{/if}
		</button>
	</div>
	{#if hasLayout}
		<div class="preview-controls">
			<label
				><input type="checkbox" bind:checked={() => settings.guides, setGuides} /> Afficher les centres
				et coordonnées</label
			>
		</div>
	{/if}
</div>
