<script lang="ts">
	import type { VirtualElement } from '@floating-ui/dom';

	import { m } from '../../../i18n/paraglide/messages';
	import { entityKey, EntityKind } from '../../canvas/canvas-entity';
	import { canvasSelectionBounds } from '../../canvas/canvas-entity-dom';
	import {
		CANVAS_SHORTCUTS,
		CanvasShortcutId,
		shortcutKeyshortcuts,
		shortcutTitle,
	} from '../../canvas/canvas-shortcuts';
	import type { CanvasSession } from '../../session/canvas-session.svelte';
	import Icon from '../ui/Icon.svelte';
	import CanvasShortcut from './CanvasShortcut.svelte';
	import FloatingActions from './FloatingActions.svelte';

	let {
		viewportElement,
		session,
		onGroup,
		onDelete,
	}: {
		viewportElement: HTMLDivElement;
		session: CanvasSession;
		onGroup?: (() => void) | undefined;
		onDelete?: (() => void) | undefined;
	} = $props();
	let floating = $state<HTMLDivElement>();
	const groupShortcut = CANVAS_SHORTCUTS[CanvasShortcutId.Group];
	const deleteShortcut = CANVAS_SHORTCUTS[CanvasShortcutId.Delete];
	let selectedNodeIds = $derived(
		[...session.selection.values()]
			.filter(({ kind }) => kind === EntityKind.Node)
			.map(({ id }) => id),
	);
	let groupable = $derived(selectedNodeIds.length === session.selectionCount);
	let anchor = $derived.by((): VirtualElement | undefined => {
		if (session.selectionCount < 2 || (!groupable && onDelete === undefined)) return undefined;
		const selected = new Set<string>(
			[...session.selection.values()].map(({ kind, id }) => entityKey(kind, id)),
		);
		return {
			contextElement: viewportElement,
			getBoundingClientRect: () =>
				canvasSelectionBounds(viewportElement, selected) ?? new DOMRect(),
		};
	});
</script>

{#if anchor}
	<CanvasShortcut
		shortcut={groupShortcut}
		scopes={[viewportElement, floating]}
		enabled={groupable && onGroup !== undefined}
		onactivate={() => onGroup?.()}
	/>
	<FloatingActions
		{anchor}
		boundary={viewportElement}
		label={m.editing_selection_actions()}
		bind:element={floating}
	>
		{#if groupable}
			<button
				class="ui-action quiet"
				type="button"
				disabled={onGroup === undefined}
				aria-label={m.editing_selection_group_aria({ count: selectedNodeIds.length })}
				aria-keyshortcuts={shortcutKeyshortcuts(groupShortcut)}
				title={shortcutTitle(groupShortcut)}
				onclick={() => onGroup?.()}
			>
				<Icon name="phosphor:folder-plus" />
				<span>{groupShortcut.label}</span>
			</button>
		{/if}
		{#if onDelete}
			<button
				class="ui-action quiet"
				type="button"
				aria-label={m.editing_selection_delete_aria({ count: session.selectionCount })}
				aria-keyshortcuts={shortcutKeyshortcuts(deleteShortcut)}
				title={shortcutTitle(deleteShortcut)}
				onclick={onDelete}
			>
				<Icon name="phosphor:trash" />
				<span>{m.common_delete()}</span>
			</button>
		{/if}
	</FloatingActions>
{/if}
