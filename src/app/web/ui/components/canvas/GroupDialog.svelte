<script lang="ts">
	import { onMount, type Snippet, tick } from 'svelte';

	import type { LayoutLane } from '../../../../../lib/core/document/logic-document';
	import type { GroupFields } from '../../../document/document-commands';
	import ContentColorPicker from '../content/ContentColorPicker.svelte';
	import Icon from '../ui/Icon.svelte';
	import ModalDialog from '../ui/ModalDialog.svelte';

	let {
		mode,
		draft,
		lanes = [],
		onchange,
		onsubmit,
		onclose,
		ondissolve,
		busy = false,
		description,
		data = {},
		text,
	}: {
		/** `name` right after grouping, `edit` from an existing group. */
		mode: 'name' | 'edit';
		draft: GroupFields;
		/** Root lanes in reading order; the selector shows for a top-level group only. */
		lanes?: readonly LayoutLane[];
		onchange: (patch: Partial<GroupFields>) => void;
		onsubmit: () => void;
		/** Cancel keeps the group as it is, including the default name after grouping. */
		onclose: () => void;
		/** Dissolves the group: members stay, the group and its relations go. */
		ondissolve: () => void;
		busy?: boolean;
		description?: string | undefined;
		data?: Record<`data-${string}`, string>;
		/** Replaces the title field, e.g. by live shared text. */
		text?: Snippet | undefined;
	} = $props();
	const formId = $props.id();
	let titleInput = $state<HTMLInputElement>();
	let submittable = $derived(!busy && (text !== undefined || draft.label.trim() !== ''));
	let subtitle = $derived.by((): { description: string } | Record<string, never> => {
		if (description === undefined) return {};
		return { description };
	});
	let title = $derived.by(() => {
		if (mode === 'name') return 'Nommer le groupe';
		return 'Modifier le groupe';
	});

	onMount(() => {
		void tick().then(() => {
			titleInput?.focus();
			titleInput?.select();
		});
	});

	function submit(): void {
		if (submittable) onsubmit();
	}
</script>

<ModalDialog eyebrow="Groupe" {title} {...subtitle} {data} {onclose} oncommit={submit}>
	<form
		class="fields"
		id={`group-dialog-${formId}`}
		onsubmit={(event) => {
			event.preventDefault();
			submit();
		}}
	>
		{#if text}
			{@render text()}
		{:else}
			<label class="ui-label"
				>Titre<input
					class="ui-field"
					aria-label="Titre du groupe"
					value={draft.label}
					disabled={busy}
					bind:this={titleInput}
					oninput={(event) => {
						onchange({ label: event.currentTarget.value });
					}}
				/></label
			>
		{/if}
		{#if lanes.length > 0 && draft.laneId !== ''}
			<label class="ui-label"
				>Lane<select
					class="ui-field"
					aria-label="Lane du groupe"
					value={draft.laneId}
					disabled={busy}
					onchange={(event) => {
						onchange({ laneId: event.currentTarget.value });
					}}
					>{#each lanes as lane (lane.id)}<option value={lane.id}>{lane.label}</option
						>{/each}</select
				></label
			>
		{/if}
		<div class="color">
			<span class="ui-label">Couleur</span>
			<ContentColorPicker
				value={draft.color || '#78716c'}
				onchange={(value: string) => {
					onchange({ color: value });
				}}
			/>
		</div>
		{#if busy}<p role="status">Modification envoyée…</p>{/if}
	</form>
	{#snippet footer()}
		<button
			class="ui-action quiet dissolve"
			type="button"
			disabled={busy}
			title="Conserve les membres ; retire le groupe et ses relations"
			onclick={ondissolve}
		>
			<Icon name="phosphor:squares-four" /> Dissoudre
		</button>
		<button class="ui-action" type="button" onclick={onclose}>
			<Icon name="phosphor:x" />
			{#if busy}Fermer{:else}Annuler{/if}
		</button>
		<button
			class="ui-action primary"
			type="submit"
			form={`group-dialog-${formId}`}
			disabled={!submittable}
		>
			<Icon name="phosphor:check" />
			{#if busy}Enregistrement…{:else}Enregistrer{/if}
		</button>
	{/snippet}
</ModalDialog>

<style>
	.fields {
		display: grid;
		gap: 16px;
		margin: 0;
	}
	.color {
		display: grid;
		gap: 6px;
	}
	.dissolve {
		margin-right: auto;
	}
</style>
