<script lang="ts">
	import { m } from '../../../i18n/paraglide/messages';
	import Icon from '../ui/Icon.svelte';
	import ModalDialog from '../ui/ModalDialog.svelte';

	let {
		retained,
		oncreate,
		onclose,
	}: {
		/** Whether the current document is kept in this browser's recent documents. */
		retained: boolean;
		oncreate: () => void;
		onclose: () => void;
	} = $props();
	let description = $derived(newDescription(retained));

	function newDescription(kept: boolean): string {
		if (kept) return m.document_new_retained_notice();
		return m.document_new_replaced_notice();
	}
</script>

<ModalDialog title={m.document_new_title()} {description} {onclose} oncommit={oncreate}>
	<p class="m-0 text-sm text-[var(--ui-muted)]">{m.document_new_body()}</p>
	{#snippet footer()}
		<button class="ui-action" type="button" onclick={onclose}>
			<Icon name="phosphor:x" />
			{m.common_cancel()}
		</button>
		<button class="ui-action primary" type="button" onclick={oncreate}>
			<Icon name="phosphor:file-plus" />
			{m.common_create()}
		</button>
	{/snippet}
</ModalDialog>
