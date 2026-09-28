<script lang="ts">
	import { entityKey, EntityKind, type EntityRef } from '../../canvas/canvas-entity';
	import { canvasEntityElement } from '../../canvas/canvas-entity-dom';
	import Icon from '../ui/Icon.svelte';
	import CanvasShortcut from './CanvasShortcut.svelte';
	import FloatingActions from './FloatingActions.svelte';

	let {
		entity,
		viewportElement,
		edit,
		onDelete,
	}: {
		entity: EntityRef;
		viewportElement: HTMLDivElement;
		edit?: { readonly label: string; readonly run: () => void } | undefined;
		onDelete?: (() => void) | undefined;
	} = $props();
	const actionsLabel = {
		[EntityKind.Node]: 'Node actions',
		[EntityKind.Group]: 'Group actions',
		[EntityKind.Junction]: 'Junction actions',
		[EntityKind.Relation]: 'Relation actions',
	};
	const deleteLabel = {
		[EntityKind.Node]: 'Supprimer le nœud',
		[EntityKind.Group]: 'Supprimer le groupe',
		[EntityKind.Junction]: 'Supprimer la jonction',
		[EntityKind.Relation]: 'Supprimer la relation',
	};
	const buttonClass =
		'flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold text-stone-800 hover:bg-stone-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-950';
	let floating = $state<HTMLDivElement>();

	let anchor = $derived(canvasEntityElement(viewportElement, entityKey(entity.kind, entity.id)));
</script>

<CanvasShortcut
	key="e"
	scopes={[viewportElement, floating]}
	enabled={edit !== undefined}
	onactivate={() => edit?.run()}
/>
{#if edit ?? onDelete}
	<FloatingActions {anchor} label={actionsLabel[entity.kind]} bind:element={floating}>
		{#if edit}
			<button
				class={buttonClass}
				type="button"
				aria-label={edit.label}
				aria-keyshortcuts="e"
				title="Edit (E)"
				onclick={edit.run}
			>
				<Icon name="phosphor:pencil-simple" />
				<span><span class="underline decoration-1 underline-offset-2">E</span>dit</span>
			</button>
		{/if}
		{#if onDelete}
			<button
				class={buttonClass}
				type="button"
				aria-label={`${deleteLabel[entity.kind]} ${entity.id}`}
				aria-keyshortcuts="Delete"
				title="Supprimer (Suppr)"
				onclick={onDelete}
			>
				<Icon name="phosphor:trash" />
				<span>Supprimer</span>
			</button>
		{/if}
	</FloatingActions>
{/if}
