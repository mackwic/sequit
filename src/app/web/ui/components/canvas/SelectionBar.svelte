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
	import Kbd from '../ui/Kbd.svelte';
	import CanvasShortcut from './CanvasShortcut.svelte';
	import FloatingActions from './FloatingActions.svelte';

	let {
		viewportElement,
		session,
		onGroup,
		onJunction,
		onDelete,
		onCopyNodes,
	}: {
		viewportElement: HTMLDivElement;
		session: CanvasSession;
		onGroup?: (() => void) | undefined;
		/** Offered when the selection is made of plain relations only: they converge on a junction. */
		onJunction?: (() => void) | undefined;
		onDelete?: (() => void) | undefined;
		onCopyNodes?: (() => void) | undefined;
	} = $props();
	let floating = $state<HTMLDivElement>();
	const groupShortcut = CANVAS_SHORTCUTS[CanvasShortcutId.Group];
	const junctionShortcut = CANVAS_SHORTCUTS[CanvasShortcutId.Junction];
	const deleteShortcut = CANVAS_SHORTCUTS[CanvasShortcutId.Delete];
	const copyShortcut = CANVAS_SHORTCUTS[CanvasShortcutId.Copy];
	let selectedNodeIds = $derived(
		[...session.selection.values()]
			.filter(({ kind }) => kind === EntityKind.Node)
			.map(({ id }) => id),
	);
	let groupable = $derived(selectedNodeIds.length === session.selectionCount);
	let anchor = $derived.by((): VirtualElement | undefined => {
		if (session.selectionCount < 2) return undefined;
		if (!groupable && onJunction === undefined && onDelete === undefined) return undefined;
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
	<CanvasShortcut
		shortcut={junctionShortcut}
		scopes={[viewportElement, floating]}
		enabled={onJunction !== undefined}
		onactivate={() => onJunction?.()}
	/>
	<FloatingActions
		{anchor}
		boundary={viewportElement}
		label={m.editing_selection_actions()}
		bind:element={floating}
	>
		{#if groupable && onCopyNodes}
			<button
				class="ui-action quiet"
				type="button"
				aria-keyshortcuts={shortcutKeyshortcuts(copyShortcut)}
				title={shortcutTitle(copyShortcut)}
				onclick={onCopyNodes}
			>
				<Icon name="phosphor:copy" /><span>{copyShortcut.label}</span><Kbd
					shortcut={copyShortcut}
				/>
			</button>
		{/if}
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
				<Kbd shortcut={groupShortcut} />
			</button>
		{/if}
		{#if onJunction}
			<button
				class="ui-action quiet"
				type="button"
				aria-label={m.editing_selection_junction_aria({ count: session.selectionCount })}
				aria-keyshortcuts={shortcutKeyshortcuts(junctionShortcut)}
				title={shortcutTitle(junctionShortcut)}
				onclick={onJunction}
			>
				<Icon name="phosphor:git-merge" />
				<span>{junctionShortcut.label}</span>
				<Kbd shortcut={junctionShortcut} />
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
				<Kbd shortcut={deleteShortcut} />
			</button>
		{/if}
	</FloatingActions>
{/if}
