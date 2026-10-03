<script lang="ts">
	import { tick } from 'svelte';

	import { m } from '../../../i18n/paraglide/messages';
	import { getLocale, locales, setLocale } from '../../../i18n/paraglide/runtime';
	import { consentPanel } from '../ui/consent-panel.svelte';
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
	const currentLocale = getLocale();
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
</script>

<!-- Pulled back by the trigger's padding: the icon, not the hover surface, keeps the header's gap. -->
<div class="-ml-2 flex min-w-0 items-center">
	{#if renaming && onrename}
		<DocumentTitle {title} {onrename} onclose={closeRename} />
	{/if}
	<!-- Kept mounted while renaming, so focus can come back to the same trigger. -->
	<div class="flex min-w-0" hidden={renaming}>
		<DropdownMenu label={m.document_menu_label()} bind:triggerElement={menuTrigger}>
			{#snippet trigger()}
				<span class="flex min-w-0 items-center gap-2">
					<span class="menu-icon"><Icon name="phosphor:list" size={18} /></span>
					<span class="title">{title}</span>
				</span>
			{/snippet}

			{#if onrename}
				<button
					role="menuitem"
					type="button"
					onclick={() => {
						renaming = true;
					}}><Icon name="phosphor:pencil-simple" />{m.document_menu_rename()}</button
				>
				<div role="separator"></div>
			{/if}
			{#if onnew}
				<button role="menuitem" type="button" onclick={onnew}
					><Icon name="phosphor:file-plus" />{m.document_menu_new()}</button
				>
			{/if}
			{#if onopen}
				<button role="menuitem" type="button" onclick={onopen}
					><Icon name="phosphor:folder-open" />{m.document_menu_open()}</button
				>
			{/if}
			{#if onrecent}
				<button role="menuitem" type="button" onclick={onrecent}
					><Icon name="phosphor:clock-counter-clockwise" />{m.document_menu_recent()}</button
				>
			{/if}
			{#if documentActions}<div role="separator"></div>{/if}
			{#if onexport}
				<button role="menuitem" type="button" onclick={onexport}
					><Icon name="phosphor:export" />{m.document_menu_export()}</button
				>
			{/if}
			{#if onexportimage}
				<button role="menuitem" type="button" onclick={onexportimage}
					><Icon name="phosphor:image" />{m.document_menu_export_image()}</button
				>
			{/if}
			<button role="menuitem" type="button" onclick={printDocument}
				><Icon name="phosphor:printer" />{m.document_menu_print()}</button
			>
			{#if consentPanel.available}
				<button
					role="menuitem"
					type="button"
					onclick={() => {
						consentPanel.show(menuTrigger);
					}}><Icon name="phosphor:shield-check" />{m.document_menu_consent()}</button
				>
			{/if}
			<div role="separator"></div>
			<div role="group" aria-label={m.document_menu_language()}>
				<p class="dropdown-heading">{m.document_menu_language()}</p>
				<!-- Each language is named in itself; choosing one reloads the page in it. -->
				{#each locales as locale (locale)}
					{@const checked = locale === currentLocale}
					<button
						role="menuitemradio"
						type="button"
						aria-checked={checked}
						lang={locale}
						onclick={() => {
							if (!checked) void setLocale(locale);
						}}
						><span class="dropdown-radio"></span>{m.document_language_name({}, { locale })}</button
					>
				{/each}
			</div>
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
	.menu-icon {
		display: inline-flex;
		flex: none;
		color: var(--ui-muted);
	}
</style>
