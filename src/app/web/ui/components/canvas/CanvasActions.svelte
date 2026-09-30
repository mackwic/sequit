<script lang="ts">
	import {
		CANVAS_SHORTCUTS,
		CanvasShortcutId,
		shortcutKeyshortcuts,
		shortcutTitle,
	} from '../../canvas/canvas-shortcuts';
	import type { CanvasSession } from '../../session/canvas-session.svelte';
	import Icon from '../ui/Icon.svelte';

	let {
		session,
		enabled,
		oncreate,
	}: {
		session: CanvasSession;
		enabled: boolean;
		/** With one selected endpoint, the new box is attached to it. */
		oncreate: () => void;
	} = $props();
	const createShortcut = CANVAS_SHORTCUTS[CanvasShortcutId.Create];
	let attached = $derived(session.relativeNodeCreationTarget !== undefined);
	let title = $derived.by(() => {
		if (attached) return shortcutTitle(createShortcut, 'Nouvelle boîte reliée à la sélection');
		return shortcutTitle(createShortcut);
	});
</script>

<nav
	class="absolute top-1/2 left-4 z-20 flex -translate-y-1/2 flex-col gap-1 rounded-lg border border-[var(--ui-border)] bg-[var(--ui-surface)] p-1 shadow-sm"
	aria-label="Actions du canvas"
>
	<button
		class="ui-action quiet"
		type="button"
		aria-label={createShortcut.label}
		aria-keyshortcuts={shortcutKeyshortcuts(createShortcut)}
		{title}
		disabled={!enabled}
		onclick={oncreate}
	>
		<Icon name="phosphor:plus-square" />
	</button>
</nav>
