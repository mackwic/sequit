<script lang="ts">
	import { tick } from 'svelte';

	import DropdownMenu from '../ui/DropdownMenu.svelte';
	import Icon from '../ui/Icon.svelte';
	import DocumentTitle from './DocumentTitle.svelte';

	let {
		title,
		onrename,
		onnew,
		onopen,
		onrecent,
		onexport,
		onexportimage,
	}: {
		title: string;
		/** Renames the document; absent while it cannot be edited. */
		onrename?: ((title: string) => void) | undefined;
		onnew?: (() => void) | undefined;
		onopen?: (() => void) | undefined;
		onrecent?: (() => void) | undefined;
		onexport?: (() => void) | undefined;
		/** Downloads the rendered canvas as a picture; absent while nothing is rendered. */
		onexportimage?: (() => void) | undefined;
	} = $props();

	let renaming = $state(false);
	let menuTrigger = $state<HTMLButtonElement>();
	let documentActions = $derived(
		onnew !== undefined || onopen !== undefined || onrecent !== undefined,
	);

	// A title that can no longer be sent (a session going offline) ends the rename unsaved.
	$effect(() => {
		if (onrename === undefined) renaming = false;
	});

	function printDocument(): void {
		window.print();
	}

	function closeRename(restoreFocus: boolean): void {
		renaming = false;
		if (restoreFocus) void tick().then(() => menuTrigger?.focus());
	}

	function caretIcon(open: boolean): string {
		if (open) return 'phosphor:caret-up';
		return 'phosphor:caret-down';
	}
</script>

<div class="flex min-w-0 items-center">
	{#if renaming && onrename}
		<DocumentTitle {title} {onrename} onclose={closeRename} />
	{/if}
	<!-- Kept mounted while renaming, so focus can come back to the same trigger. -->
	<div class="flex min-w-0" hidden={renaming}>
		<DropdownMenu label="Menu du document" bind:triggerElement={menuTrigger}>
			{#snippet trigger(open)}
				<span class="flex min-w-0 items-center gap-1.5">
					<span class="title">{title}</span>
					<span class="caret"><Icon name={caretIcon(open === true)} size={14} /></span>
				</span>
			{/snippet}

			{#if onrename}
				<button
					role="menuitem"
					type="button"
					onclick={() => {
						renaming = true;
					}}><Icon name="phosphor:pencil-simple" />Renommer le document</button
				>
				<div role="separator"></div>
			{/if}
			{#if onnew}
				<button role="menuitem" type="button" onclick={onnew}
					><Icon name="phosphor:file-plus" />Nouveau document</button
				>
			{/if}
			{#if onopen}
				<button role="menuitem" type="button" onclick={onopen}
					><Icon name="phosphor:folder-open" />Ouvrir…</button
				>
			{/if}
			{#if onrecent}
				<button role="menuitem" type="button" onclick={onrecent}
					><Icon name="phosphor:clock-counter-clockwise" />Documents récents…</button
				>
			{/if}
			{#if documentActions}<div role="separator"></div>{/if}
			{#if onexport}
				<button role="menuitem" type="button" onclick={onexport}
					><Icon name="phosphor:export" />Exporter…</button
				>
			{/if}
			{#if onexportimage}
				<button role="menuitem" type="button" onclick={onexportimage}
					><Icon name="phosphor:image" />Exporter l’image…</button
				>
			{/if}
			<button role="menuitem" type="button" onclick={printDocument}
				><Icon name="phosphor:printer" />Imprimer…</button
			>
		</DropdownMenu>
	</div>
</div>

<style>
	.title {
		overflow: hidden;
		max-width: min(40vw, 26rem);
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 14px;
		font-weight: 550;
	}
	.caret {
		display: inline-flex;
		flex: none;
		color: var(--ui-muted);
	}
</style>
