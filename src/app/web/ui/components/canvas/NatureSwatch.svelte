<script lang="ts">
	import Icon from '../ui/Icon.svelte';

	let {
		color,
		icon,
		iconSize = 14,
	}: {
		color: string | undefined;
		icon: string;
		iconSize?: number;
	} = $props();
</script>

<!-- The nature's own colour and icon, as its boxes wear them. -->
<span class="swatch" style:--content-color={color} aria-hidden="true"
	><Icon name={icon} size={iconSize} /></span
>

<style>
	.swatch {
		display: inline-flex;
		flex: none;
		width: 24px;
		height: 24px;
		align-items: center;
		justify-content: center;
		border: 1px solid color-mix(in srgb, var(--content-color, var(--ui-muted)) 35%, transparent);
		border-radius: 6px;
		background: color-mix(in srgb, var(--content-color, var(--ui-muted)) 14%, white);
		color: var(--content-color, var(--ui-text));
	}
</style>
