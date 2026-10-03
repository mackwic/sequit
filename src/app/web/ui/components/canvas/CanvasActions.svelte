<script lang="ts">
	import type { LogicNature } from '../../../../../lib/core/document/logic-document';
	import { m } from '../../../i18n/paraglide/messages';
	import {
		CANVAS_SHORTCUTS,
		CanvasShortcutId,
		shortcutKeyshortcuts,
		shortcutTitle,
	} from '../../canvas/canvas-shortcuts';
	import DropdownMenu from '../ui/DropdownMenu.svelte';
	import Icon from '../ui/Icon.svelte';
	import NatureMenuItems from './NatureMenuItems.svelte';
	import NatureSwatch from './NatureSwatch.svelte';

	let {
		enabled,
		natures,
		nature,
		oncreate,
		onnature,
		onnatures,
	}: {
		enabled: boolean;
		natures: readonly LogicNature[];
		/** The nature the next boxes take. */
		nature: LogicNature | undefined;
		/** A root box, in the lane of the selection when there is one. */
		oncreate: () => void;
		/** Chooses the nature of the next boxes. */
		onnature: (natureId: string) => void;
		/** Opens the document's nature library. */
		onnatures: () => void;
	} = $props();
	const createShortcut = CANVAS_SHORTCUTS[CanvasShortcutId.Create];
	const createTip = shortcutTitle(createShortcut);
	let natureTip = $derived.by(() => {
		if (nature === undefined) return m.common_natures();
		return m.editing_canvas_next_nature_tip({ label: nature.label });
	});
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
		<DropdownMenu
			label={m.editing_canvas_next_nature()}
			disabled={!enabled}
			placement="right-start"
		>
			{#snippet trigger()}
				<NatureSwatch
					color={nature?.color}
					icon={nature?.icon ?? 'phosphor:tag'}
					iconSize={16}
				/><span class="sr-only">{natureTip}</span>
			{/snippet}
			<NatureMenuItems {natures} checkedId={nature?.id} onselect={onnature} />
			<div role="separator"></div>
			<button role="menuitem" type="button" onclick={onnatures}
				><Icon name="phosphor:tag" /><span>{m.editing_canvas_manage_natures()}</span></button
			>
		</DropdownMenu>
		<span class="tip" aria-hidden="true">{natureTip}</span>
	</span>
</nav>

<style>
	/* The tooltip sits beside the toolbar so it never covers the button it names. */
	.tool {
		position: relative;
		display: flex;
		justify-content: center;
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
	.tool:has(:global([aria-expanded='true'])) .tip {
		opacity: 0;
		visibility: hidden;
	}
	.tool :global(.dropdown-trigger) {
		justify-content: center;
		padding: 5px;
	}
	@media (hover: none) {
		.tip {
			display: none;
		}
	}
</style>
