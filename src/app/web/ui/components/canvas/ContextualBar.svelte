<script lang="ts">
	import { m } from '../../../i18n/paraglide/messages';
	import { entityKey, EntityKind, type EntityRef } from '../../canvas/canvas-entity';
	import { canvasEntityElement } from '../../canvas/canvas-entity-dom';
	import {
		CANVAS_SHORTCUTS,
		CanvasShortcutId,
		shortcutKeyshortcuts,
		shortcutTitle,
	} from '../../canvas/canvas-shortcuts';
	import { foldActionLabel, foldToggleShortcut } from '../../canvas/group-edit';
	import Icon from '../ui/Icon.svelte';
	import Kbd from '../ui/Kbd.svelte';
	import CanvasShortcut from './CanvasShortcut.svelte';
	import FloatingActions from './FloatingActions.svelte';

	let {
		entity,
		viewportElement,
		edit,
		fold,
		dissolve,
		split,
		child,
		sibling,
		paste,
		onDelete,
	}: {
		entity: EntityRef;
		viewportElement: HTMLDivElement;
		edit?: { readonly label: string; readonly run: () => void } | undefined;
		/** `[` folds and `]` unfolds this group: the entity itself, or the container of a node or junction. */
		fold?:
			{ readonly groupId: string; readonly closed: boolean; readonly run: () => void } | undefined;
		/** Group only: members stay, the group goes. */
		dissolve?: (() => void) | undefined;
		/** Relation only: inserts a junction between its endpoints. */
		split?: (() => void) | undefined;
		/** Node or junction only: starts typing a child attached to it. */
		child?: (() => void) | undefined;
		/** Node only: starts typing a sibling, reached by `S` and by its handle. */
		sibling?: (() => void) | undefined;
		paste?: (() => void) | undefined;
		onDelete?: (() => void) | undefined;
	} = $props();
	const actionsLabel = {
		[EntityKind.Node]: () => m.editing_context_actions_node(),
		[EntityKind.Group]: () => m.editing_context_actions_group(),
		[EntityKind.Junction]: () => m.editing_context_actions_junction(),
		[EntityKind.Relation]: () => m.editing_context_actions_relation(),
	};
	const deleteLabel = {
		[EntityKind.Node]: () => m.editing_context_delete_node(),
		[EntityKind.Group]: () => m.editing_context_delete_group(),
		[EntityKind.Junction]: () => m.editing_context_delete_junction(),
		[EntityKind.Relation]: () => m.editing_context_delete_relation(),
	};
	let floating = $state<HTMLDivElement>();
	const editShortcut = CANVAS_SHORTCUTS[CanvasShortcutId.Edit];
	const deleteShortcut = CANVAS_SHORTCUTS[CanvasShortcutId.Delete];
	const junctionShortcut = CANVAS_SHORTCUTS[CanvasShortcutId.Junction];
	const childShortcut = CANVAS_SHORTCUTS[CanvasShortcutId.CreateChild];
	const pasteShortcut = CANVAS_SHORTCUTS[CanvasShortcutId.Paste];

	let anchor = $derived(canvasEntityElement(viewportElement, entityKey(entity.kind, entity.id)));
	function foldIcon(closed: boolean): string {
		if (closed) return 'phosphor:arrows-out';
		return 'phosphor:arrows-in';
	}
	/** The bar shows fold controls only on the group; a member only gets the keys. */
	let ownFold = $derived.by(() => {
		if (fold === undefined || entity.kind !== EntityKind.Group) return undefined;
		return fold;
	});
	let foldKey = $derived(fold?.closed === false);
	let unfoldKey = $derived(fold?.closed === true);
</script>

<CanvasShortcut
	shortcut={editShortcut}
	scopes={[viewportElement, floating]}
	enabled={edit !== undefined}
	onactivate={() => edit?.run()}
/>
<CanvasShortcut
	shortcut={CANVAS_SHORTCUTS[CanvasShortcutId.Fold]}
	scopes={[viewportElement, floating]}
	enabled={foldKey}
	onactivate={() => fold?.run()}
/>
<CanvasShortcut
	shortcut={CANVAS_SHORTCUTS[CanvasShortcutId.Unfold]}
	scopes={[viewportElement, floating]}
	enabled={unfoldKey}
	onactivate={() => fold?.run()}
/>
<CanvasShortcut
	shortcut={junctionShortcut}
	scopes={[viewportElement, floating]}
	enabled={split !== undefined}
	onactivate={() => split?.()}
/>
<CanvasShortcut
	shortcut={childShortcut}
	scopes={[viewportElement, floating]}
	enabled={child !== undefined}
	onactivate={() => child?.()}
/>
<CanvasShortcut
	shortcut={CANVAS_SHORTCUTS[CanvasShortcutId.CreateSibling]}
	scopes={[viewportElement, floating]}
	enabled={sibling !== undefined}
	onactivate={() => sibling?.()}
/>
{#if edit ?? child ?? ownFold ?? dissolve ?? split ?? paste ?? onDelete}
	<FloatingActions
		{anchor}
		boundary={viewportElement}
		label={actionsLabel[entity.kind]()}
		bind:element={floating}
	>
		{#if child}
			<button
				class="ui-action quiet"
				type="button"
				aria-label={m.editing_context_create_child_aria({ id: entity.id })}
				aria-keyshortcuts={shortcutKeyshortcuts(childShortcut)}
				title={shortcutTitle(childShortcut)}
				onclick={child}
			>
				<Icon name="phosphor:tree-structure" />
				<span>{childShortcut.label}</span>
				<Kbd shortcut={childShortcut} />
			</button>
		{/if}
		{#if edit}
			<button
				class="ui-action quiet"
				type="button"
				aria-label={edit.label}
				aria-keyshortcuts={shortcutKeyshortcuts(editShortcut)}
				title={shortcutTitle(editShortcut)}
				onclick={edit.run}
			>
				<Icon name="phosphor:sliders-horizontal" />
				<span>{editShortcut.label}</span>
				<Kbd shortcut={editShortcut} />
			</button>
		{/if}
		{#if ownFold}
			{@const toggle = foldToggleShortcut(ownFold.closed)}
			{@const label = foldActionLabel(ownFold.closed)}
			<button
				class="ui-action quiet"
				type="button"
				aria-label={m.editing_context_fold_aria({ label, id: entity.id })}
				aria-expanded={!ownFold.closed}
				aria-keyshortcuts={shortcutKeyshortcuts(toggle)}
				title={shortcutTitle(toggle)}
				onclick={ownFold.run}
			>
				<Icon name={foldIcon(ownFold.closed)} />
				<span>{label}</span>
				<Kbd shortcut={toggle} />
			</button>
		{/if}
		{#if dissolve}
			<button
				class="ui-action quiet"
				type="button"
				aria-label={m.editing_context_dissolve_aria({ id: entity.id })}
				title={m.editing_context_dissolve_hint()}
				onclick={dissolve}
			>
				<Icon name="phosphor:squares-four" />
				<span>{m.common_dissolve()}</span>
			</button>
		{/if}
		{#if paste}
			<button
				class="ui-action quiet"
				type="button"
				aria-keyshortcuts={shortcutKeyshortcuts(pasteShortcut)}
				title={shortcutTitle(pasteShortcut)}
				onclick={paste}
			>
				<Icon name="phosphor:clipboard-text" /><span>{m.canvas_paste_here()}</span><Kbd
					shortcut={pasteShortcut}
				/>
			</button>
		{/if}
		{#if split}
			<button
				class="ui-action quiet"
				type="button"
				aria-label={m.editing_context_split_aria({ id: entity.id })}
				aria-keyshortcuts={shortcutKeyshortcuts(junctionShortcut)}
				title={shortcutTitle(junctionShortcut)}
				onclick={split}
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
				aria-label={m.editing_context_delete_aria({
					label: deleteLabel[entity.kind](),
					id: entity.id,
				})}
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
