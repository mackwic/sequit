<script lang="ts">
	import { onMount, type Snippet, tick } from 'svelte';

	import {
		type ContentStyle,
		contentStyleFields,
		type LogicNature,
	} from '../../../../../lib/core/document/logic-document';
	import type { NodeFields } from '../../../../../lib/infrastructure/document/node-fields';
	import {
		CANVAS_SHORTCUTS,
		CanvasShortcutId,
		shortcutKeyshortcuts,
	} from '../../canvas/canvas-shortcuts';
	import ContentStyleEditor from '../content/ContentStyleEditor.svelte';
	import Icon from '../ui/Icon.svelte';
	import Kbd from '../ui/Kbd.svelte';
	import ModalDialog from '../ui/ModalDialog.svelte';

	let {
		mode,
		natures,
		draft,
		onchange,
		onsubmit,
		onclose,
		busy = false,
		deleted = false,
		diagnostic,
		description,
		data = {},
		text,
	}: {
		mode: 'create' | 'edit';
		natures: readonly LogicNature[];
		draft: NodeFields;
		onchange: (patch: Partial<NodeFields>) => void;
		/** Create or save; the caller decides what the fields become. */
		onsubmit: () => void;
		/** Cancel: nothing is created, an edit keeps its last saved state. */
		onclose: () => void;
		busy?: boolean;
		/** The edited node is gone; the draft stays readable, saving is impossible. */
		deleted?: boolean;
		diagnostic?: string | undefined;
		description?: string | undefined;
		data?: Record<`data-${string}`, string>;
		/** Replaces the content and description fields, e.g. by live shared text. */
		text?: Snippet | undefined;
	} = $props();
	const formId = $props.id();
	const confirmShortcut = CANVAS_SHORTCUTS[CanvasShortcutId.Confirm];
	let content = $state<HTMLTextAreaElement>();
	let nature = $derived(natures.find(({ id }) => id === draft.natureId));
	let submittable = $derived(!busy && !deleted && nature !== undefined);
	let style = $derived<ContentStyle>(
		contentStyleFields(draft.color || undefined, draft.icon || undefined),
	);
	let inherited = $derived.by((): { inherited: ContentStyle } | Record<string, never> => {
		if (nature === undefined) return {};
		return { inherited: contentStyleFields(nature.color, nature.icon) };
	});
	let subtitle = $derived.by((): { description: string } | Record<string, never> => {
		if (description === undefined) return {};
		return { description };
	});
	let title = $derived.by(() => {
		if (mode === 'create') return 'Nouvelle boîte';
		return 'Modifier la boîte';
	});

	onMount(() => {
		void tick().then(() => {
			content?.focus();
		});
	});

	function submit(): void {
		if (submittable) onsubmit();
	}
</script>

<ModalDialog eyebrow="Boîte" {title} {...subtitle} width="wide" {data} {onclose} oncommit={submit}>
	<form
		class="fields"
		id={`node-dialog-${formId}`}
		onsubmit={(event) => {
			event.preventDefault();
			submit();
		}}
	>
		<label class="ui-label"
			>Nature<select
				class="ui-field"
				value={draft.natureId}
				disabled={busy}
				onchange={(event) => {
					onchange({ natureId: event.currentTarget.value });
				}}
				>{#each natures as candidate (candidate.id)}<option value={candidate.id}
						>{candidate.label}</option
					>{/each}</select
			></label
		>
		{#if natures.length === 0}<p class="ui-notice warning">
				Ajoutez d’abord une nature au document.
			</p>{/if}
		{#if text}
			{@render text()}
		{:else}
			<label class="ui-label"
				>Contenu<textarea
					class="ui-field"
					rows="5"
					value={draft.markdown}
					disabled={busy}
					bind:this={content}
					oninput={(event) => {
						onchange({ markdown: event.currentTarget.value });
					}}></textarea></label
			>
			<label class="ui-label"
				>Description<textarea
					class="ui-field"
					rows="3"
					value={draft.description}
					disabled={busy}
					oninput={(event) => {
						onchange({ description: event.currentTarget.value });
					}}></textarea></label
			>
		{/if}
		<details class="style">
			<summary class="ui-label">Couleur et icône</summary>
			<ContentStyleEditor
				value={style}
				{...inherited}
				onchange={(value: ContentStyle) => {
					onchange({ color: value.color ?? '', icon: value.icon ?? '' });
				}}
			/>
		</details>
		{#if busy}<p role="status">Modification envoyée…</p>{/if}
		{#if diagnostic}<p class="ui-notice error" role="alert">{diagnostic}</p>{/if}
	</form>
	{#snippet footer()}
		<button class="ui-action" type="button" onclick={onclose}>
			<Icon name="phosphor:x" />
			{#if busy}Fermer{:else}Annuler{/if}
		</button>
		<button
			class="ui-action primary"
			type="submit"
			form={`node-dialog-${formId}`}
			disabled={!submittable}
			aria-keyshortcuts={shortcutKeyshortcuts(confirmShortcut)}
		>
			{#if mode === 'create'}<Icon name="phosphor:plus" /> Créer{:else}<Icon
					name="phosphor:check"
				/>
				{#if busy}Enregistrement…{:else}Enregistrer{/if}{/if}
			<Kbd shortcut={confirmShortcut} />
		</button>
	{/snippet}
</ModalDialog>

<style>
	.fields {
		display: grid;
		gap: 16px;
		margin: 0;
	}
	.style {
		display: grid;
		gap: 12px;
	}
	.style summary {
		cursor: pointer;
	}
</style>
