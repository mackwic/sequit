<script lang="ts">
	import type { Snippet } from 'svelte';

	import { m } from '../../../i18n/paraglide/messages';
	import SharedEditDialog from './SharedEditDialog.svelte';

	let { label, children }: { label: string; children: Snippet } = $props();
	let editing = $state(false);
</script>

<div class="element-card">
	<strong>{label}</strong><button
		class="ui-action"
		type="button"
		aria-label={m.collaboration_element_edit_aria({ label })}
		onclick={() => {
			editing = true;
		}}>{m.collaboration_element_edit()}</button
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
</style>
