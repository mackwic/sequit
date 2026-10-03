<script lang="ts">
	import type { VirtualElement } from '@floating-ui/dom';

	import { m } from '../../../i18n/paraglide/messages';
	import {
		CANVAS_SHORTCUTS,
		CanvasShortcutId,
		shortcutKeyshortcuts,
	} from '../../canvas/canvas-shortcuts';
	import type { CanvasPoint } from '../../canvas/canvas-viewport';
	import Icon from '../ui/Icon.svelte';
	import Kbd from '../ui/Kbd.svelte';
	import MenuSurface from '../ui/MenuSurface.svelte';

	let {
		point,
		viewport,
		oncopy,
		onclose,
	}: {
		point: CanvasPoint | undefined;
		viewport: HTMLElement;
		oncopy: () => void;
		onclose: () => void;
	} = $props();
	const copy = CANVAS_SHORTCUTS[CanvasShortcutId.Copy];
	let anchor = $derived.by((): VirtualElement | undefined => {
		if (point === undefined) return undefined;
		return {
			contextElement: viewport,
			getBoundingClientRect: () => new DOMRect(point.x, point.y, 0, 0),
		};
	});

	function close(restoreFocus: boolean): void {
		onclose();
		if (restoreFocus) viewport.focus({ preventScroll: true });
	}
</script>

<MenuSurface
	open={point !== undefined}
	label={m.editing_selection_actions()}
	{anchor}
	gap={2}
	restoreFocusOnSelect
	onclose={close}
>
	<button
		role="menuitem"
		type="button"
		aria-keyshortcuts={shortcutKeyshortcuts(copy)}
		onclick={oncopy}
		><Icon name="phosphor:copy" /><span>{copy.label}</span><Kbd shortcut={copy} /></button
	>
</MenuSurface>
