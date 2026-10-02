<script lang="ts">
	import { m } from '../../../i18n/paraglide/messages';
	import {
		CANVAS_SHORTCUTS,
		CanvasShortcutId,
		shortcutKeyshortcuts,
		shortcutTitle,
	} from '../../canvas/canvas-shortcuts';
	import Icon from '../ui/Icon.svelte';

	let {
		enabled,
		oncreate,
		onnatures,
	}: {
		enabled: boolean;
		/** A root box, in the lane of the selection when there is one. */
		oncreate: () => void;
		/** Opens the document's nature library. */
		onnatures: () => void;
	} = $props();
	const createShortcut = CANVAS_SHORTCUTS[CanvasShortcutId.Create];
	const natureLabel = () => m.common_natures();
	const createTip = shortcutTitle(createShortcut);
</script>

<nav
	class="absolute top-1/2 left-4 z-20 flex -translate-y-1/2 flex-col gap-1 rounded-lg border border-[var(--ui-border)] bg-[var(--ui-surface)] p-1 shadow-sm print:hidden"
	aria-label={m.editing_canvas_actions()}
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
			aria-label={natureLabel()}
			disabled={!enabled}
			onclick={onnatures}
		>
			<Icon name="phosphor:tag" />
		</button>
		<span class="tip" aria-hidden="true">{m.editing_canvas_manage_natures()}</span>
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
