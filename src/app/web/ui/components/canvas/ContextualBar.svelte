<script lang="ts">
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
		/** Node or junction only: opens the box dialog for a child attached to it. */
		child?: (() => void) | undefined;
		onDelete?: (() => void) | undefined;
	} = $props();
	const actionsLabel = {
		[EntityKind.Node]: 'Actions du nœud',
		[EntityKind.Group]: 'Actions du groupe',
		[EntityKind.Junction]: 'Actions de la jonction',
		[EntityKind.Relation]: 'Actions de la relation',
	};
	const deleteLabel = {
		[EntityKind.Node]: 'Supprimer le nœud',
		[EntityKind.Group]: 'Supprimer le groupe',
		[EntityKind.Junction]: 'Supprimer la jonction',
		[EntityKind.Relation]: 'Supprimer la relation',
	};
	let floating = $state<HTMLDivElement>();
	const editShortcut = CANVAS_SHORTCUTS[CanvasShortcutId.Edit];
	const deleteShortcut = CANVAS_SHORTCUTS[CanvasShortcutId.Delete];
	const junctionShortcut = CANVAS_SHORTCUTS[CanvasShortcutId.Junction];
	const childShortcut = CANVAS_SHORTCUTS[CanvasShortcutId.CreateChild];

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
{#if edit ?? child ?? ownFold ?? dissolve ?? split ?? onDelete}
	<FloatingActions
		{anchor}
		boundary={viewportElement}
		label={actionsLabel[entity.kind]}
		bind:element={floating}
	>
		{#if edit}
			<button
				class="ui-action quiet"
				type="button"
				aria-label={edit.label}
				aria-keyshortcuts={shortcutKeyshortcuts(editShortcut)}
				title={shortcutTitle(editShortcut)}
				onclick={edit.run}
			>
				<Icon name="phosphor:pencil-simple" />
				<span>{editShortcut.label}</span>
			</button>
		{/if}
		{#if child}
			<button
				class="ui-action quiet"
				type="button"
				aria-label={`Créer un enfant de ${entity.id}`}
				aria-keyshortcuts={shortcutKeyshortcuts(childShortcut)}
				title={shortcutTitle(childShortcut)}
				onclick={child}
			>
				<Icon name="phosphor:tree-structure" />
				<span>{childShortcut.label}</span>
			</button>
		{/if}
		{#if ownFold}
			{@const toggle = foldToggleShortcut(ownFold.closed)}
			{@const label = foldActionLabel(ownFold.closed)}
			<button
				class="ui-action quiet"
				type="button"
				aria-label={`${label} le groupe ${entity.id}`}
				aria-expanded={!ownFold.closed}
				aria-keyshortcuts={shortcutKeyshortcuts(toggle)}
				title={shortcutTitle(toggle)}
				onclick={ownFold.run}
			>
				<Icon name={foldIcon(ownFold.closed)} />
				<span>{label}</span>
			</button>
		{/if}
		{#if dissolve}
			<button
				class="ui-action quiet"
				type="button"
				aria-label={`Dissoudre le groupe ${entity.id}`}
				title="Dissoudre : conserve les membres"
				onclick={dissolve}
			>
				<Icon name="phosphor:squares-four" />
				<span>Dissoudre</span>
			</button>
		{/if}
		{#if split}
			<button
				class="ui-action quiet"
				type="button"
				aria-label={`Insérer une jonction sur ${entity.id}`}
				aria-keyshortcuts={shortcutKeyshortcuts(junctionShortcut)}
				title={shortcutTitle(junctionShortcut)}
				onclick={split}
			>
				<Icon name="phosphor:git-merge" />
				<span>{junctionShortcut.label}</span>
			</button>
		{/if}
		{#if onDelete}
			<button
				class="ui-action quiet"
				type="button"
				aria-label={`${deleteLabel[entity.kind]} ${entity.id}`}
				aria-keyshortcuts={shortcutKeyshortcuts(deleteShortcut)}
				title={shortcutTitle(deleteShortcut)}
				onclick={onDelete}
			>
				<Icon name="phosphor:trash" />
				<span>Supprimer</span>
			</button>
		{/if}
	</FloatingActions>
{/if}
