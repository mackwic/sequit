<script lang="ts">
	import { iconUrl } from '$lib/icons/phosphor';
	let { name, size = 16 }: { name: string; size?: number } = $props();
	let url = $derived(iconUrl(name));
</script>

{#if name !== 'none'}
	<span
		class="icon"
		aria-hidden="true"
		data-icon={name}
		style:width={`${size}px`}
		style:height={`${size}px`}
	>
		{#if url}<span class="screen" style:mask-image={`url("${url}")`}></span><img
				src={url}
				alt=""
				width={size}
				height={size}
			/>
		{:else}<span class="unavailable">?</span>{/if}
	</span>
{/if}

<style>
	.icon {
		display: inline-flex;
		flex: none;
		vertical-align: -0.2em;
		position: relative;
	}
	.screen {
		width: 100%;
		height: 100%;
		background: currentColor;
		mask-size: contain;
		mask-repeat: no-repeat;
		mask-position: center;
	}
	img {
		display: none;
	}
	.unavailable {
		width: 100%;
		border: 1px dashed currentColor;
		border-radius: 3px;
		font-size: 10px;
		text-align: center;
		line-height: 1.4;
	}
	@media print {
		.screen {
			display: none;
		}
		img {
			display: block;
		}
	}
	@media (forced-colors: active) {
		.screen {
			background: CanvasText;
		}
	}
</style>
