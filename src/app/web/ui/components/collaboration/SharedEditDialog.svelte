<script lang="ts">
	import { onMount, type Snippet, tick } from 'svelte';

	import Icon from '../ui/Icon.svelte';
	import ModalDialog from '../ui/ModalDialog.svelte';
	let {
		label,
		description = 'Les modifications sont partagées en direct.',
		onclose,
		oncancel,
		oncommitclose,
		children,
	}: {
		label: string;
		description?: string;
		onclose: () => void;
		oncancel?: () => void;
		oncommitclose?: () => void;
		children: Snippet;
	} = $props();
	let body = $state<HTMLDivElement>();
	// The shared fields start with a destructive button; land on the first editable field instead.
	onMount(() => {
		void tick().then(() => {
			body
				?.querySelector<HTMLElement>(
					'input:not([type="hidden"]):not(:disabled), textarea:not(:disabled), [contenteditable="true"], select:not(:disabled)',
				)
				?.focus();
		});
	});
</script>

<ModalDialog title={label} {description} width="wide" {onclose} {oncancel} oncommit={oncommitclose}>
	<div bind:this={body}>{@render children()}</div>
	{#snippet footer()}
		<button class="ui-action" type="button" onclick={onclose}>
			<Icon name="phosphor:x" /> Fermer
		</button>
	{/snippet}
</ModalDialog>
