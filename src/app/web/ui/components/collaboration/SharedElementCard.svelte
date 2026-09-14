<script lang="ts">
	import type { Snippet } from 'svelte';

	import SharedEditDialog from './SharedEditDialog.svelte';
	let { label, children }: { label: string; children: Snippet } = $props();
	let editing = $state(false);
</script>

<div class="element-card">
	<strong>{label}</strong><button
		type="button"
		aria-label={`Modifier ${label}`}
		onclick={() => {
			editing = true;
		}}>Modifier</button
	>
</div>
{#if editing}<SharedEditDialog
		{label}
		onclose={() => {
			editing = false;
		}}>{@render children()}</SharedEditDialog
	>{/if}

<style>
	.element-card {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 8px 0;
	}
	strong {
		font-size: 13px;
		overflow-wrap: anywhere;
	}
	button {
		padding: 5px 10px;
		border: 1px solid #d6d3d1;
		border-radius: 6px;
		background: white;
		cursor: pointer;
	}
</style>
