<script lang="ts">
	import Icon from '../ui/Icon.svelte';
	let { label, markdown, icon }: { label: string; markdown: string; icon: string } = $props();
</script>

<span class="node-header"><Icon name={icon} size={15} /><span>{label}</span></span>
<span class="node-body">{markdown}</span>

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
	}

	.node-body {
		display: block;
		padding: 0.9rem 0.75rem 1rem;
		color: var(--content-text);
		font-size: 0.875rem;
		line-height: 1.45;
		white-space: pre-wrap;
	}

	@media print {
		.node-header {
			background: white;
			color: black;
			border-color: #999;
		}
	}
</style>
