<script lang="ts">
	import type { VirtualElement } from '@floating-ui/dom';

	import { m } from '../../../i18n/paraglide/messages';
	import {
		CANVAS_SHORTCUTS,
		CanvasShortcutId,
		shortcutKeyshortcuts,
	} from '../../canvas/canvas-shortcuts';
	import { type CanvasPoint, DEFAULT_CANVAS_ZOOM } from '../../canvas/canvas-viewport';
	import type { CanvasSession } from '../../session/canvas-session.svelte';
	import Icon from '../ui/Icon.svelte';
	import Kbd from '../ui/Kbd.svelte';
	import MenuSurface from '../ui/MenuSurface.svelte';

	let {
		point,
		viewport,
		session,
		onselectall,
		onManageNatures,
		onExport,
		onExportImage,
		onclose,
	}: {
		/** Where the background was right-clicked, in client pixels; absent while closed. */
		point: CanvasPoint | undefined;
		/** The canvas, which gets focus back so that its keys keep working. */
		viewport: HTMLElement;
		session: CanvasSession;
		onselectall: () => void;
		/** Each action below is offered only when its owner provides it. */
		onManageNatures?: (() => void) | undefined;
		onExport?: (() => void) | undefined;
		onExportImage?: (() => void) | undefined;
		onclose: () => void;
	} = $props();
	const selectAll = CANVAS_SHORTCUTS[CanvasShortcutId.SelectAll];
	let anchor = $derived.by((): VirtualElement | undefined => {
		if (point === undefined) return undefined;
		const { x, y } = point;
		return { contextElement: viewport, getBoundingClientRect: () => new DOMRect(x, y, 0, 0) };
	});
	let exports = $derived(onExport !== undefined || onExportImage !== undefined);
	let resettable = $derived(session.zoom !== DEFAULT_CANVAS_ZOOM);

	function close(restoreFocus: boolean): void {
		onclose();
		if (restoreFocus) viewport.focus({ preventScroll: true });
	}
</script>

<MenuSurface
	open={point !== undefined}
	label={m.canvas_context_menu()}
	{anchor}
	gap={2}
	restoreFocusOnSelect
	onclose={close}
>
	<button
		role="menuitem"
		type="button"
		aria-keyshortcuts={shortcutKeyshortcuts(selectAll)}
		onclick={onselectall}
		><Icon name="phosphor:selection-all" /><span>{selectAll.label}</span><Kbd
			shortcut={selectAll}
		/></button
	>
	{#if onManageNatures}
		<div role="separator"></div>
		<button role="menuitem" type="button" onclick={onManageNatures}
			><Icon name="phosphor:tag" /><span>{m.editing_canvas_manage_natures()}</span></button
		>
	{/if}
	{#if exports}<div role="separator"></div>{/if}
	{#if onExport}
		<button role="menuitem" type="button" onclick={onExport}
			><Icon name="phosphor:export" /><span>{m.document_menu_export()}</span></button
		>
	{/if}
	{#if onExportImage}
		<button role="menuitem" type="button" onclick={onExportImage}
			><Icon name="phosphor:image" /><span>{m.document_menu_export_image()}</span></button
		>
	{/if}
	<div role="separator"></div>
	{#if session.canZoomIn}
		<button role="menuitem" type="button" onclick={() => session.zoomIn()}
			><Icon name="phosphor:magnifying-glass-plus" /><span>{m.editing_zoom_in()}</span></button
		>
	{/if}
	{#if session.canZoomOut}
		<button role="menuitem" type="button" onclick={() => session.zoomOut()}
			><Icon name="phosphor:magnifying-glass-minus" /><span>{m.editing_zoom_out()}</span></button
		>
	{/if}
	{#if resettable}
		<button role="menuitem" type="button" onclick={() => session.resetZoom()}
			><Icon name="phosphor:frame-corners" /><span>{m.editing_zoom_reset_hint()}</span></button
		>
	{/if}
</MenuSurface>
