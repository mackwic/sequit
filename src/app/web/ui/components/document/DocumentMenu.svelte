<script lang="ts">
	import DropdownMenu from '../ui/DropdownMenu.svelte';
	import Icon from '../ui/Icon.svelte';

	let { title }: { title: string } = $props();

	function printDocument(): void {
		window.print();
	}

	function caretIcon(open: boolean): string {
		if (open) return 'phosphor:caret-up';
		return 'phosphor:caret-down';
	}
</script>

<DropdownMenu label="Menu du document">
	{#snippet trigger(open)}
		<Icon name="phosphor:list" size={18} />
		<span class="title">{title}</span>
		<Icon name={caretIcon(open === true)} size={13} />
	{/snippet}

	<button role="menuitem" type="button" disabled><Icon name="phosphor:folder-open" />Ouvrir…</button
	>
	<button role="menuitem" type="button" disabled
		><Icon name="phosphor:clock-counter-clockwise" />Documents récents</button
	>
	<div role="separator"></div>
	<button role="menuitem" type="button" disabled
		><Icon name="phosphor:file-text" />Réglages du document…</button
	>
	<button role="menuitem" type="button" disabled><Icon name="phosphor:stack" />Natures…</button>
	<button role="menuitem" type="button" disabled
		><Icon name="phosphor:flow-arrow" />Mise en page…</button
	>
	<div role="separator"></div>
	<button role="menuitem" type="button" disabled><Icon name="phosphor:export" />Exporter…</button>
	<button role="menuitem" type="button" onclick={printDocument}
		><Icon name="phosphor:printer" />Imprimer…</button
	>
	<button role="menuitem" type="button" disabled
		><Icon name="phosphor:copy" />Créer une copie…</button
	>
</DropdownMenu>

<style>
	.title {
		overflow: hidden;
		max-width: min(42vw, 28rem);
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 14px;
		font-weight: 550;
	}
</style>
