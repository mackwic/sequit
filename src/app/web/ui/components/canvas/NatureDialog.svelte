<script lang="ts">
	import { type Snippet, tick } from 'svelte';

	import {
		type ContentStyle,
		contentStyleFields,
		type LogicNature,
	} from '../../../../../lib/core/document/logic-document';
	import {
		adoptableFamilyNatures,
		isNatureFamilyId,
		missingFamilyNatures,
		NATURE_FAMILIES,
		type NatureFamily,
		natureFamilyGroups,
	} from '../../../../../lib/core/document/nature-families';
	import {
		natureDraftChanged,
		type NatureEditing,
		NatureEditingMode,
		type NatureFields,
		natureRemoval,
		NatureRemovalKind,
	} from '../../../../../lib/infrastructure/document/nature-fields';
	import { m } from '../../../i18n/paraglide/messages';
	import {
		CANVAS_SHORTCUTS,
		CanvasShortcutId,
		shortcutKeyshortcuts,
	} from '../../canvas/canvas-shortcuts';
	import { natureFamilyName } from '../../content/nature-families';
	import ContentStyleEditor from '../content/ContentStyleEditor.svelte';
	import DropdownMenu from '../ui/DropdownMenu.svelte';
	import Icon from '../ui/Icon.svelte';
	import Kbd from '../ui/Kbd.svelte';
	import ModalDialog from '../ui/ModalDialog.svelte';
	import NodeContent from './NodeContent.svelte';

	let {
		natures,
		usage,
		editing,
		onselect,
		oncreate,
		onchange,
		onsave,
		ondelete,
		onimport,
		onclose,
		busy = false,
		description,
		data = {},
		text,
	}: {
		natures: readonly LogicNature[];
		/** Boxes per nature; the deletion step reads it to require a replacement. */
		usage: ReadonlyMap<string, number>;
		/** The form beside the list; nothing to edit yet when absent. */
		editing: NatureEditing | undefined;
		/** Opens another nature in the form; any change is saved first. */
		onselect: (natureId: string) => void;
		/** Opens a blank nature of the given family in the form; any change is saved first. */
		oncreate: (family: string) => void;
		onchange: (patch: Partial<NatureFields>) => void;
		/** Creates or saves the form without leaving it; resolves whether it went through. */
		onsave: () => boolean | Promise<boolean>;
		/** Removes the edited nature; used boxes move to the replacement. */
		ondelete: (replacementId: string | undefined) => void;
		/** Adds the family's natures the document lacks. */
		onimport: (family: NatureFamily) => void;
		/** Closes without saving the form. */
		onclose: () => void;
		busy?: boolean;
		description?: string | undefined;
		data?: Record<`data-${string}`, string>;
		/** Replaces the label field of an existing nature, e.g. by live shared text. */
		text?: Snippet | undefined;
	} = $props();
	const formId = $props.id();
	const confirmShortcut = CANVAS_SHORTCUTS[CanvasShortcutId.Confirm];
	let labelInput = $state<HTMLInputElement>();
	let manager = $state<HTMLDivElement>();
	let removeButton = $state<HTMLButtonElement>();
	let removalCancel = $state<HTMLButtonElement>();
	/** The removal step belongs to one nature: selecting another leaves it. */
	let removingId = $state<string>();
	let replacementId = $state('');
	let removing = $derived(removingId !== undefined && removingId === editing?.id);
	let liveLabel = $derived(editing?.mode === NatureEditingMode.Edit && text !== undefined);
	let labelled = $derived(
		editing !== undefined && (liveLabel || editing.draft.label.trim() !== ''),
	);
	let submittable = $derived(!busy && labelled);
	let changed = $derived(editing !== undefined && natureDraftChanged(editing));
	let removal = $derived.by(() => {
		if (editing?.mode !== NatureEditingMode.Edit) return undefined;
		return natureRemoval(natures, usage, editing.id);
	});
	let removalCandidates = $derived.by(() => {
		if (removal?.kind !== NatureRemovalKind.Reassign) return [];
		return removal.candidates;
	});
	let removable = $derived.by(() => {
		if (busy || removal === undefined) return false;
		if (removal.kind === NatureRemovalKind.Free) return true;
		return removalCandidates.some(({ id }) => id === replacementId);
	});
	let style = $derived.by((): ContentStyle => {
		if (editing === undefined) return {};
		return contentStyleFields(editing.draft.color, editing.draft.icon || 'none');
	});
	let subtitle = $derived.by((): { description: string } | Record<string, never> => {
		if (description === undefined) return {};
		return { description };
	});
	let title = $derived.by(() => {
		if (removing) return m.editing_nature_dialog_title_remove();
		return m.common_natures();
	});
	/** Escape leaves the removal step; elsewhere it closes, like the backdrop. */
	let cancel = $derived.by((): (() => void) | undefined => {
		if (removing) return leaveRemoval;
		return undefined;
	});
	/**
	 * The list shows the edited nature as its form stands, in the family it is getting, and the
	 * one being created among them.
	 */
	let groups = $derived.by(() => {
		const current = editing;
		if (current === undefined) return natureFamilyGroups(natures);
		const shown = natures.map((nature) => {
			if (nature.id === current.id) return draftNature(current);
			return nature;
		});
		if (current.mode === NatureEditingMode.Create) shown.push(draftNature(current));
		return natureFamilyGroups(shown);
	});
	let candidateGroups = $derived(natureFamilyGroups(removalCandidates));
	/** A family from a newer catalogue stays selectable as it is named in the document. */
	let unknownFamily = $derived.by(() => {
		const family = editing?.draft.family ?? '';
		return family !== '' && !isNatureFamilyId(family);
	});
	let families = $derived(
		NATURE_FAMILIES.map((family) => ({
			family,
			missing: missingFamilyNatures(natures, family).length,
			adoptable: adoptableFamilyNatures(natures, family).length,
		})),
	);
	let creatingId = $derived.by(() => {
		if (editing?.mode !== NatureEditingMode.Create) return undefined;
		return editing.id;
	});
	let editedId = $derived(editing?.id);

	$effect(() => {
		if (creatingId !== undefined) void tick().then(() => labelInput?.focus());
	});
	$effect(() => {
		if (editedId !== undefined)
			restoreFocus(() => manager?.querySelector<HTMLElement>('[aria-current="true"]'));
	});

	/**
	 * The dialog's keys only reach it while focus is inside: when the focused control goes away,
	 * such as a removed nature or the step's own button, focus moves to the given one.
	 */
	function restoreFocus(target: () => HTMLElement | null | undefined): void {
		void tick().then(() => {
			if (manager?.closest('dialog')?.contains(document.activeElement) === false) target()?.focus();
		});
	}

	function draftNature({ id, base, draft }: NatureEditing): LogicNature {
		const nature = {
			id,
			label: draft.label.trim() || base.label || m.editing_nature_create(),
			color: draft.color,
			icon: draft.icon || 'none',
		};
		if (draft.family === '') return nature;
		return { ...nature, family: draft.family };
	}
	/** Leaves the form for another nature, a new one or the canvas, saving its changes first. */
	async function leave(next: () => void): Promise<void> {
		if (busy) return;
		if (editing === undefined || !changed) {
			next();
			return;
		}
		if (!labelled) {
			// A nature still being created has nothing worth keeping without a label.
			if (editing.mode === NatureEditingMode.Create) next();
			else labelInput?.focus();
			return;
		}
		if (await onsave()) next();
	}
	function select(natureId: string): void {
		if (natureId === editing?.id) return;
		void leave(() => {
			onselect(natureId);
		});
	}
	function create(): void {
		const family = editing?.draft.family ?? '';
		void leave(() => {
			oncreate(family);
		});
	}
	function submit(): void {
		if (submittable && !removing) void leave(onclose);
	}
	function commit(): void {
		if (removing) remove();
		else submit();
	}
	function usageLabel(natureId: string): string {
		const count = usage.get(natureId) ?? 0;
		if (count === 0) return m.editing_nature_usage_none();
		return m.editing_nature_usage({ count });
	}
	function removalSentence(natureId: string, label: string): string {
		const count = usage.get(natureId) ?? 0;
		return m.editing_nature_reassign({ count, label });
	}
	function familyStatus(missing: number, adoptable: number): string {
		const parts: string[] = [];
		if (missing > 0) parts.push(m.editing_nature_family_missing({ count: missing }));
		if (adoptable > 0) parts.push(m.editing_nature_family_adoptable({ count: adoptable }));
		if (parts.length === 0) return m.editing_nature_family_present();
		return parts.join(' · ');
	}
	function enterRemoval(): void {
		replacementId = removalCandidates[0]?.id ?? '';
		removingId = editing?.id;
		restoreFocus(() => removalCancel);
	}
	function leaveRemoval(): void {
		removingId = undefined;
		restoreFocus(() => removeButton);
	}
	function remove(): void {
		if (!removable) return;
		if (removal?.kind === NatureRemovalKind.Reassign) ondelete(replacementId);
		else ondelete(undefined);
	}
</script>

<ModalDialog
	eyebrow={m.editing_document_eyebrow()}
	{title}
	{...subtitle}
	{data}
	{onclose}
	width="wide"
	oncancel={cancel}
	oncommit={commit}
>
	<div class="manager" bind:this={manager}>
		<div class="library">
			<div class="natures" role="group" aria-label={m.editing_document_natures_aria()}>
				{#each groups as group (group.family?.id ?? '')}
					{@const name = natureFamilyName(group.family)}
					<p class="family-name" aria-hidden="true">{name}</p>
					<ul aria-label={name}>
						{#each group.natures as nature (nature.id)}
							<li>
								<button
									class="nature"
									type="button"
									aria-current={nature.id === editing?.id}
									disabled={busy || removing}
									onclick={() => {
										select(nature.id);
									}}
								>
									<span class="swatch" style:--content-color={nature.color}
										><Icon name={nature.icon ?? 'none'} /></span
									>
									<span class="label">{nature.label}</span>
									<span class="usage">{usageLabel(nature.id)}</span>
								</button>
							</li>
						{/each}
					</ul>
				{/each}
			</div>
			{#if natures.length === 0}<p class="ui-notice warning">
					{m.editing_nature_empty_warning()}
				</p>{/if}
			<div class="library-actions">
				<button class="ui-action" type="button" disabled={busy || removing} onclick={create}>
					<Icon name="phosphor:plus" />
					{m.editing_nature_create()}
				</button>
				<DropdownMenu label={m.editing_nature_families_menu()} disabled={busy || removing}>
					{#snippet trigger()}
						<Icon name="phosphor:stack" />
						<span>{m.editing_nature_families()}</span>
						<Icon name="phosphor:caret-down" size={12} />
					{/snippet}
					<p class="dropdown-heading">{m.editing_nature_families_menu()}</p>
					{#each families as { family, missing, adoptable } (family.id)}
						<button
							role="menuitem"
							type="button"
							disabled={missing + adoptable === 0}
							onclick={() => {
								onimport(family);
							}}
						>
							<span class="template">
								<span class="template-name">{natureFamilyName(family)}</span>
								<span class="template-natures">
									{#each family.natures as nature (nature.id)}
										<span class="chip"
											><span class="swatch small" style:--content-color={nature.color}
												><Icon name={nature.icon ?? 'none'} size={12} /></span
											>{nature.label}</span
										>
									{/each}
								</span>
								<span class="template-status">{familyStatus(missing, adoptable)}</span>
							</span>
						</button>
					{/each}
				</DropdownMenu>
			</div>
		</div>
		<div class="detail">
			{#if editing === undefined}
				<p class="placeholder">{m.editing_nature_none_selected()}</p>
			{:else if removing}
				<div class="removal">
					{#if removal?.kind === NatureRemovalKind.Free}
						<p>{m.editing_nature_removal_free({ label: editing.draft.label })}</p>
					{:else if removal?.kind === NatureRemovalKind.Reassign}
						<p>{removalSentence(editing.id, editing.draft.label)}</p>
						<label class="ui-label"
							>{m.editing_nature_reassign_field()}<select
								class="ui-field"
								bind:value={replacementId}
								disabled={busy}
								>{#each candidateGroups as group (group.family?.id ?? '')}<optgroup
										label={natureFamilyName(group.family)}
										>{#each group.natures as candidate (candidate.id)}<option value={candidate.id}
												>{candidate.label}</option
											>{/each}</optgroup
									>{/each}</select
							></label
						>
					{:else}
						<p class="ui-notice warning">
							{m.editing_nature_removal_blocked()}
						</p>
					{/if}
				</div>
			{:else}
				<form
					class="fields"
					id={`nature-dialog-${formId}`}
					onsubmit={(event) => {
						event.preventDefault();
						submit();
					}}
				>
					<article class="node-card" style:--content-color={editing.draft.color} aria-hidden="true">
						<NodeContent
							label={editing.draft.label.trim() || m.common_nature()}
							markdown={m.editing_nature_preview_sample()}
							icon={editing.draft.icon || 'none'}
						/>
					</article>
					{#if liveLabel && text}
						{@render text()}
					{:else}
						<label class="ui-label"
							>{m.editing_label()}<input
								class="ui-field"
								aria-label={m.common_nature_label()}
								aria-invalid={changed && !labelled}
								value={editing.draft.label}
								disabled={busy}
								bind:this={labelInput}
								oninput={(event) => {
									onchange({ label: event.currentTarget.value });
								}}
							/></label
						>
					{/if}
					<label class="ui-label"
						>{m.editing_nature_family()}<select
							class="ui-field"
							value={editing.draft.family}
							disabled={busy}
							onchange={(event) => {
								onchange({ family: event.currentTarget.value });
							}}
							>{#each NATURE_FAMILIES as family (family.id)}<option value={family.id}
									>{natureFamilyName(family)}</option
								>{/each}{#if unknownFamily}<option value={editing.draft.family}
									>{editing.draft.family}</option
								>{/if}<option value="">{natureFamilyName(undefined)}</option></select
						></label
					>
					<ContentStyleEditor
						value={style}
						onchange={(value: ContentStyle) => {
							let icon = value.icon ?? '';
							if (icon === 'none') icon = '';
							onchange({ color: value.color ?? editing.draft.color, icon });
						}}
					/>
					{#if busy}<p role="status">{m.common_change_sent()}</p>{/if}
				</form>
			{/if}
		</div>
	</div>
	{#snippet footer()}
		{#if removing}
			<button class="ui-action" type="button" bind:this={removalCancel} onclick={leaveRemoval}>
				<Icon name="phosphor:x" />
				{m.common_cancel()}
			</button>
			<button
				class="ui-action danger"
				type="button"
				disabled={!removable}
				aria-keyshortcuts={shortcutKeyshortcuts(confirmShortcut)}
				onclick={remove}
			>
				<Icon name="phosphor:trash" />
				{m.common_delete()}
				<Kbd shortcut={confirmShortcut} />
			</button>
		{:else}
			{#if editing?.mode === NatureEditingMode.Edit}
				<button
					class="ui-action danger remove"
					type="button"
					disabled={busy}
					title={m.editing_nature_delete_hint()}
					bind:this={removeButton}
					onclick={enterRemoval}
				>
					<Icon name="phosphor:trash" />
					{m.common_delete()}
				</button>
			{/if}
			<button class="ui-action" type="button" onclick={onclose}>
				<Icon name="phosphor:x" />
				{#if busy}{m.common_close()}{:else}{m.common_cancel()}{/if}
			</button>
			<button
				class="ui-action primary"
				type="submit"
				form={`nature-dialog-${formId}`}
				disabled={!submittable}
				aria-keyshortcuts={shortcutKeyshortcuts(confirmShortcut)}
			>
				{#if editing?.mode === NatureEditingMode.Create}<Icon name="phosphor:plus" />
					{m.common_create()}{:else}<Icon name="phosphor:check" />
					{#if busy}{m.common_saving()}{:else}{m.common_save()}{/if}{/if}
				<Kbd shortcut={confirmShortcut} />
			</button>
		{/if}
	{/snippet}
</ModalDialog>

<style>
	.manager {
		display: grid;
		gap: 20px;
		min-width: 0;
	}
	@media (min-width: 641px) {
		.manager {
			grid-template-columns: 210px minmax(0, 1fr);
			align-items: start;
		}
		/* Its own layer: the template menu opens over the form beside it. */
		.library {
			position: sticky;
			top: 0;
			z-index: 1;
		}
	}
	.library {
		display: grid;
		gap: 12px;
		min-width: 0;
	}
	.natures {
		display: grid;
		gap: 4px;
	}
	.natures ul {
		display: grid;
		gap: 2px;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.family-name {
		margin: 8px 8px 0;
		color: var(--ui-muted);
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}
	.family-name:first-child {
		margin-top: 0;
	}
	.nature {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		column-gap: 10px;
		align-items: center;
		width: 100%;
		padding: 6px 8px;
		border: 1px solid transparent;
		border-radius: 9px;
		background: transparent;
		color: var(--ui-text);
		font: inherit;
		text-align: left;
		cursor: pointer;
	}
	.nature:hover:not(:disabled) {
		background: var(--ui-subtle);
	}
	.nature[aria-current='true'],
	.nature[aria-current='true']:hover:not(:disabled) {
		border-color: color-mix(in srgb, var(--ui-accent) 45%, var(--ui-border));
		background: var(--ui-accent-soft);
	}
	.nature:focus-visible {
		outline: 2px solid var(--ui-accent);
		outline-offset: 2px;
	}
	.nature:disabled {
		opacity: 0.45;
		cursor: default;
	}
	/* The nature's own colour and icon, as its boxes wear them. */
	.swatch {
		display: grid;
		flex: none;
		grid-row: span 2;
		place-items: center;
		width: 28px;
		height: 28px;
		border: 1px solid color-mix(in srgb, var(--content-color) 35%, transparent);
		border-radius: 7px;
		background: color-mix(in srgb, var(--content-color) 14%, white);
		color: var(--content-color);
	}
	.swatch.small {
		width: 18px;
		height: 18px;
		border-radius: 5px;
	}
	.label {
		font-size: 13px;
		font-weight: 550;
		overflow-wrap: anywhere;
	}
	.usage {
		color: var(--ui-muted);
		font-size: 11px;
	}
	.library-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	/* The template menu opens from a button styled like its neighbour. */
	.library-actions :global(.dropdown-trigger) {
		gap: 0.45em;
		min-height: 32px;
		border: 1px solid var(--ui-border);
		border-radius: 7px;
		padding: 7px 10px;
		background: var(--ui-surface);
		font-size: 12px;
		font-weight: 550;
	}
	.library-actions :global(.dropdown-trigger:disabled) {
		opacity: 0.45;
		cursor: default;
	}
	.template {
		display: grid;
		gap: 4px;
	}
	.template-name {
		font-weight: 600;
	}
	.template-natures {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 10px;
		color: var(--ui-muted);
		font-size: 12px;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 4px;
	}
	.template-status {
		color: var(--ui-muted);
		font-size: 11px;
	}
	.detail {
		min-width: 0;
	}
	.placeholder {
		margin: 0;
		padding: 24px 0;
		color: var(--ui-muted);
		text-align: center;
	}
	.removal {
		display: grid;
		gap: 16px;
	}
	.removal p {
		margin: 0;
	}
	.fields {
		display: grid;
		gap: 20px;
		margin: 0;
	}
	.node-card {
		border: 1px solid color-mix(in srgb, var(--content-color) 35%, #d6d3d1);
		border-radius: 0.75rem;
		background: var(--content-surface);
		box-shadow:
			0 1px 2px rgb(28 25 23 / 0.06),
			0 8px 24px rgb(28 25 23 / 0.06);
		overflow: hidden;
	}
	.remove {
		margin-right: auto;
	}
</style>
