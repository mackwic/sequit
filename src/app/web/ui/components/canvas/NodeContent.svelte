<script lang="ts">
	import type { Snippet } from 'svelte';

	import Icon from '../ui/Icon.svelte';
	import NodeBody from './NodeBody.svelte';
	let {
		label,
		markdown,
		icon,
		body,
	}: {
		label: string;
		markdown: string;
		icon: string;
		/** Replaces the rendered Markdown, e.g. by the editor of a box being typed. */
		body?: Snippet | undefined;
	} = $props();
</script>

<span class="node-header" data-node-header><Icon name={icon} size={15} /><span>{label}</span></span>
<span class="node-body"
	>{#if body}{@render body()}{:else}<NodeBody {markdown} />{/if}</span
>

<style>
	.node-header {
		display: flex;
		align-items: center;
		gap: 7px;
		border-bottom: 1px solid color-mix(in srgb, var(--content-color) 25%, white);
		background: color-mix(in srgb, var(--content-color) 13%, white);
		padding: 0.55rem 0.75rem;
		color: var(--content-header-ink);
		font-size: 0.7rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		transition-property: color, border-color, background-color;
		transition-duration: var(--canvas-motion-duration);
		transition-timing-function: var(--canvas-motion-easing);
	}

	.node-body {
		display: block;
		padding: 0.9rem 0.75rem 1rem;
		color: var(--content-text);
		font-size: 0.875rem;
		line-height: 1.45;
		white-space: pre-wrap;
	}
</style>
