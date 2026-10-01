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
		onnatures,
	}: {
		session: CanvasSession;
		enabled: boolean;
		/** With one selected endpoint, the new box is attached to it. */
		oncreate: () => void;
		/** Opens the document's nature library. */
		onnatures: () => void;
	} = $props();
	const createShortcut = CANVAS_SHORTCUTS[CanvasShortcutId.Create];
	const NATURES_LABEL = 'Natures';
	let attached = $derived(session.relativeNodeCreationTarget !== undefined);
	let createTip = $derived.by(() => {
		if (attached) return shortcutTitle(createShortcut, 'Nouvelle boîte reliée à la sélection');
		return shortcutTitle(createShortcut);
	});
</script>

<nav
	class="absolute top-1/2 left-4 z-20 flex -translate-y-1/2 flex-col gap-1 rounded-lg border border-[var(--ui-border)] bg-[var(--ui-surface)] p-1 shadow-sm print:hidden"
	aria-label="Actions du canvas"
>
	<span class="tool">
		<button
			class="ui-action quiet"
			type="button"
			aria-label={createShortcut.label}
			aria-keyshortcuts={shortcutKeyshortcuts(createShortcut)}
			disabled={!enabled}
			onclick={oncreate}
		>
			<Icon name="phosphor:plus-square" />
		</button>
		<span class="tip" aria-hidden="true">{createTip}</span>
	</span>
	<span class="tool">
		<button
			class="ui-action quiet"
			type="button"
			aria-label={NATURES_LABEL}
			disabled={!enabled}
			onclick={onnatures}
		>
			<Icon name="phosphor:tag" />
		</button>
		<span class="tip" aria-hidden="true">Gérer les natures du document</span>
	</span>
</nav>

<style>
	/* The tooltip sits beside the toolbar so it never covers the button it names. */
	.tool {
		position: relative;
		display: flex;
	}
	.tip {
		position: absolute;
		top: 50%;
		left: calc(100% + 10px);
		z-index: 1;
		padding: 4px 8px;
		border-radius: 6px;
		background: var(--ui-text);
		color: var(--ui-surface);
		font-size: 12px;
		font-weight: 500;
		line-height: 1.4;
		white-space: nowrap;
		transform: translateY(-50%);
		opacity: 0;
		visibility: hidden;
		transition:
			opacity 120ms ease,
			visibility 120ms;
		pointer-events: none;
	}
	.tip::before {
		content: '';
		position: absolute;
		top: 50%;
		right: 100%;
		border: 5px solid transparent;
		border-right-color: var(--ui-text);
		transform: translateY(-50%);
	}
	.tool:hover .tip,
	.tool:has(:focus-visible) .tip {
		opacity: 1;
		visibility: visible;
		transition-delay: 350ms;
	}
	@media (hover: none) {
		.tip {
			display: none;
		}
	}
</style>
