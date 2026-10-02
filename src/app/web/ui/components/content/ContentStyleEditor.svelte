<script lang="ts">
	import { type ContentStyle, contentStyleFields } from '$lib/core/document/logic-document';

	import { m } from '../../../i18n/paraglide/messages';
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
	<section aria-label={m.content_style_editor_color_section_aria()}>
		<div class="heading">
			<strong class="ui-label">{m.common_color()}</strong>{#if inherited}<span
					>{#if value.color === undefined}{m.content_style_editor_inherited()}{:else}{m.content_style_editor_custom()}{/if}</span
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
				}}
				><Icon name="phosphor:arrow-counter-clockwise" />
				{m.content_style_editor_reset_color()}</button
			>{/if}
	</section>
	<section aria-label={m.content_style_editor_icon_section_aria()}>
		<div class="heading">
			<strong class="ui-label">{m.common_icon()}</strong>{#if inherited}<span
					>{#if value.icon === undefined}{m.content_style_editor_inherited()}{:else}{m.content_style_editor_custom()}{/if}</span
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
				}}
				><Icon name="phosphor:arrow-counter-clockwise" />
				{m.content_style_editor_reset_icon()}</button
			>{/if}
	</section>
</div>

<style>
	.style-editor {
		display: grid;
		gap: 20px;
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
	}
	.heading span {
		color: var(--ui-muted);
		font-size: 11px;
	}
	.reset {
		justify-self: start;
		font-size: 11px;
	}
</style>
