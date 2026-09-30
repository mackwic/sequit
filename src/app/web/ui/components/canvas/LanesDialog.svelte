<script lang="ts">
	import { untrack } from 'svelte';

	import {
		LaneOrientation,
		type LogicDocument,
	} from '../../../../../lib/core/document/logic-document';
	import type { SharedDocumentCommand } from '../../../../../lib/infrastructure/document/shared-document-command';
	import { lanesUpdate } from '../../../document/document-commands';
	import {
		activateLanes,
		addLane,
		disableLanes,
		draftRootLanes,
		draftTransfers,
		type LanesDraft,
		lanesDraft,
		moveLane,
		pendingTransfers,
		removeLane,
		renameLane,
		submittableLanes,
		transferLane,
	} from '../../../document/lanes-draft';
	import {
		laneOrientationLabel,
		MAX_ROOT_LANES,
		unsupportedByRootLanes,
	} from '../../canvas/root-lanes';
	import Icon from '../ui/Icon.svelte';
	import ModalDialog from '../ui/ModalDialog.svelte';

	let {
		document,
		busy = false,
		onsubmit,
		onclose,
	}: {
		document: LogicDocument;
		busy?: boolean;
		/** One command for the whole lane set; the caller dispatches and closes on success. */
		onsubmit: (command: SharedDocumentCommand) => void;
		onclose: () => void;
	} = $props();
	const formId = $props.id();
	// The draft belongs to the document opened with the dialog; a concurrent edit does not reset it.
	let draft = $state<LanesDraft>(untrack(() => lanesDraft(document)));
	let transfers = $derived(pendingTransfers(draft));
	let submittable = $derived(!busy && submittableLanes(draft));
	let orientations = $derived(
		[LaneOrientation.Parallel, LaneOrientation.Transverse].map((orientation) => ({
			orientation,
			label: laneOrientationLabel(orientation, document.layout.direction),
		})),
	);

	let removalHint = $derived.by((): string | undefined => {
		if (draft.lanes.length <= 2) return 'Il faut au moins deux lanes';
		return undefined;
	});
	let addHint = $derived.by((): string | undefined => {
		if (draft.lanes.length >= MAX_ROOT_LANES)
			return `Le moteur prend en charge ${MAX_ROOT_LANES} lanes au plus pour l’instant`;
		return undefined;
	});
	let unsupportedContent = $derived(unsupportedByRootLanes(document));
	function laneId(): string {
		return `lane-${crypto.randomUUID().slice(0, 8)}`;
	}
	function submit(): void {
		if (submittable) onsubmit(lanesUpdate(draftRootLanes(draft), draftTransfers(draft)));
	}
</script>

<ModalDialog
	eyebrow="Mise en page"
	title="Lanes"
	description="Les lanes répartissent les boîtes de premier niveau en colonnes ou en bandes fixes, par exemple par équipe ou par rôle."
	data={{ 'data-lanes-dialog': '' }}
	{onclose}
	oncommit={submit}
>
	<form
		class="fields"
		id={`lanes-dialog-${formId}`}
		onsubmit={(event) => {
			event.preventDefault();
			submit();
		}}
	>
		{#if draft.lanes.length === 0}
			{#if unsupportedContent}
				<p class="ui-notice warning">
					Le moteur de lanes ne prend pas encore en charge les jonctions ni les groupes contenant
					des boîtes : ce document en a, le canvas afficherait un diagnostic.
				</p>
			{/if}
			<p class="empty">
				Ce document n’a pas de lanes : toutes les boîtes partagent le même espace.
			</p>
			<button
				class="ui-action primary activate"
				type="button"
				disabled={busy}
				onclick={() => {
					draft = activateLanes(draft, laneId);
				}}><Icon name="phosphor:columns" /> Activer les lanes</button
			>
		{:else}
			<fieldset class="orientation">
				<legend class="ui-label">Orientation</legend>
				{#each orientations as option (option.orientation)}
					<label class="radio"
						><input
							type="radio"
							name={`lanes-orientation-${formId}`}
							value={option.orientation}
							checked={draft.orientation === option.orientation}
							disabled={busy}
							onchange={() => {
								draft = { ...draft, orientation: option.orientation };
							}}
						/>{option.label}</label
					>
				{/each}
			</fieldset>
			<ol class="lanes" aria-label="Lanes">
				{#each draft.lanes as lane, index (lane.id)}
					<li>
						<input
							class="ui-field"
							aria-label={`Nom de la lane ${index + 1}`}
							value={lane.label}
							disabled={busy}
							oninput={(event) => {
								draft = renameLane(draft, lane.id, event.currentTarget.value);
							}}
						/>
						<button
							class="ui-action quiet"
							type="button"
							aria-label={`Monter ${lane.label}`}
							disabled={busy || index === 0}
							onclick={() => {
								draft = moveLane(draft, lane.id, -1);
							}}><Icon name="phosphor:arrow-up" /></button
						>
						<button
							class="ui-action quiet"
							type="button"
							aria-label={`Descendre ${lane.label}`}
							disabled={busy || index === draft.lanes.length - 1}
							onclick={() => {
								draft = moveLane(draft, lane.id, 1);
							}}><Icon name="phosphor:arrow-down" /></button
						>
						<button
							class="ui-action quiet"
							type="button"
							aria-label={`Supprimer ${lane.label}`}
							title={removalHint}
							disabled={busy || draft.lanes.length <= 2}
							onclick={() => {
								draft = removeLane(draft, lane.id);
							}}><Icon name="phosphor:x" /></button
						>
					</li>
				{/each}
			</ol>
			<button
				class="ui-action add"
				type="button"
				title={addHint}
				disabled={busy || draft.lanes.length >= MAX_ROOT_LANES}
				onclick={() => {
					draft = addLane(draft, laneId());
				}}><Icon name="phosphor:plus" /> Ajouter une lane</button
			>
			{#if unsupportedContent}
				<p class="ui-notice warning">
					Le moteur de lanes ne prend pas encore en charge les jonctions ni les groupes contenant
					des boîtes : tant qu’il y en a, le canvas affiche un diagnostic à la place de la mise en
					page.
				</p>
			{/if}
			{#each transfers as transfer (transfer.lane.id)}
				<label class="ui-label transfer"
					>Les {transfer.lane.count} éléments de « {transfer.lane.label} » rejoignent<select
						class="ui-field"
						value={transfer.target}
						disabled={busy}
						onchange={(event) => {
							draft = transferLane(draft, transfer.lane.id, event.currentTarget.value);
						}}
						>{#each draft.lanes as lane (lane.id)}<option value={lane.id}>{lane.label}</option
							>{/each}</select
					></label
				>
			{/each}
		{/if}
		{#if busy}<p role="status">Modification envoyée…</p>{/if}
	</form>
	{#snippet footer()}
		{#if draft.lanes.length > 0}
			<button
				class="ui-action quiet disable"
				type="button"
				disabled={busy}
				title="Toutes les boîtes reviennent dans un espace unique"
				onclick={() => {
					draft = disableLanes(draft);
				}}><Icon name="phosphor:rows" /> Désactiver les lanes</button
			>
		{/if}
		<button class="ui-action" type="button" onclick={onclose}>
			<Icon name="phosphor:x" />
			{#if busy}Fermer{:else}Annuler{/if}
		</button>
		<button
			class="ui-action primary"
			type="submit"
			form={`lanes-dialog-${formId}`}
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
	.empty {
		margin: 0;
		color: var(--ui-muted);
		font-size: 13px;
	}
	.activate {
		justify-self: start;
	}
	.orientation {
		display: flex;
		gap: 16px;
		margin: 0;
		padding: 0;
		border: 0;
	}
	.orientation legend {
		margin-bottom: 6px;
	}
	.radio {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 13px;
	}
	.lanes {
		display: grid;
		gap: 8px;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.lanes li {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto auto auto;
		gap: 4px;
		align-items: center;
	}
	.add {
		justify-self: start;
	}
	.transfer {
		display: grid;
		gap: 6px;
	}
	.disable {
		margin-right: auto;
	}
</style>
