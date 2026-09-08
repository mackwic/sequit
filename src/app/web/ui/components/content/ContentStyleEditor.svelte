<script lang="ts">
	import { type ContentStyle, contentStyleFields } from '$lib/core/document/logic-document';

	import Icon from '../ui/Icon.svelte';
	import ContentColorPicker from './ContentColorPicker.svelte';
	import ContentIconPicker from './ContentIconPicker.svelte';
	let {
		value,
		inherited,
		onchange,
	}: { value: ContentStyle; inherited?: ContentStyle; onchange: (value: ContentStyle) => void } =
		$props();
	let color = $derived(value.color ?? inherited?.color ?? '#6366f1');
	let icon = $derived(value.icon ?? inherited?.icon ?? 'none');
</script>

<div class="style-editor">
	<section aria-label="Style de couleur">
		<div class="heading">
			<strong>Couleur</strong>{#if inherited}<span
					>{#if value.color === undefined}Hérité de la nature{:else}Personnalisé{/if}</span
				>{/if}
		</div>
		<ContentColorPicker
			value={color}
			onchange={(color: string) => {
				onchange(contentStyleFields(color, value.icon));
			}}
		/>
		{#if inherited && value.color !== undefined}<button
				type="button"
				class="ui-action reset"
				onclick={() => {
					onchange(contentStyleFields(undefined, value.icon));
				}}><Icon name="phosphor:arrow-counter-clockwise" /> Hériter de la couleur</button
			>{/if}
	</section>
	<section aria-label="Style d’icône">
		<div class="heading">
			<strong>Icône</strong>{#if inherited}<span
					>{#if value.icon === undefined}Hérité de la nature{:else}Personnalisé{/if}</span
				>{/if}
		</div>
		<ContentIconPicker
			value={icon}
			onchange={(icon: string) => {
				onchange(contentStyleFields(value.color, icon));
			}}
		/>
		{#if inherited && value.icon !== undefined}<button
				type="button"
				class="ui-action reset"
				onclick={() => {
					onchange(contentStyleFields(value.color, undefined));
				}}><Icon name="phosphor:arrow-counter-clockwise" /> Hériter de l’icône</button
			>{/if}
	</section>
</div>

<style>
	.style-editor {
		display: grid;
		gap: 16px;
		color: var(--ui-text);
	}
	section {
		display: grid;
		gap: 8px;
		min-width: 0;
	}
	.heading {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 8px;
		font-size: 12px;
	}
	.heading span {
		color: var(--ui-muted);
		font-size: 10px;
	}
	.reset {
		justify-self: start;
		font-size: 10px;
	}
</style>
