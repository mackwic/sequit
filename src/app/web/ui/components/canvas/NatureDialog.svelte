<script lang="ts">
	import { type Snippet, tick } from 'svelte';

	import {
		type ContentStyle,
		contentStyleFields,
		type LogicNature,
	} from '../../../../../lib/core/document/logic-document';
	import {
		type NatureEditing,
		NatureEditingMode,
		type NatureFields,
		natureRemoval,
		NatureRemovalKind,
	} from '../../../../../lib/infrastructure/document/nature-fields';
	import { m } from '../../../i18n/paraglide/messages';
	import ContentStyleEditor from '../content/ContentStyleEditor.svelte';
	import Icon from '../ui/Icon.svelte';
	import ModalDialog from '../ui/ModalDialog.svelte';
	import NodeContent from './NodeContent.svelte';

	let {
		natures,
		usage,
		editing,
		onselect,
		oncreate,
		onchange,
		onsubmit,
		onback,
		ondelete,
		onclose,
		busy = false,
		description,
		data = {},
		text,
	}: {
		natures: readonly LogicNature[];
		/** Boxes per nature; the deletion step reads it to require a replacement. */
		usage: ReadonlyMap<string, number>;
		/** The list shows while nothing is edited; the form otherwise. */
		editing: NatureEditing | undefined;
		onselect: (natureId: string) => void;
		oncreate: () => void;
		onchange: (patch: Partial<NatureFields>) => void;
		/** Create or save; the caller decides what the fields become. */
		onsubmit: () => void;
		/** Leaves the form for the list without saving. */
		onback: () => void;
		/** Removes the edited nature; used boxes move to the replacement. */
		ondelete: (replacementId: string | undefined) => void;
		onclose: () => void;
		busy?: boolean;
		description?: string | undefined;
		data?: Record<`data-${string}`, string>;
		/** Replaces the label field of an existing nature, e.g. by live shared text. */
		text?: Snippet | undefined;
	} = $props();
	const formId = $props.id();
	let labelInput = $state<HTMLInputElement>();
	let removing = $state(false);
	let replacementId = $state('');
	let liveLabel = $derived(editing?.mode === NatureEditingMode.Edit && text !== undefined);
	let submittable = $derived(
		!busy && editing !== undefined && (liveLabel || editing.draft.label.trim() !== ''),
	);
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
		if (editing === undefined) return m.common_natures();
		if (removing) return m.editing_nature_dialog_title_remove();
		if (editing.mode === NatureEditingMode.Create) return m.editing_nature_dialog_title_create();
		return m.editing_nature_dialog_title_edit();
	});
	/** Escape steps back inside the dialog; only the list closes it. */
	let cancel = $derived.by((): (() => void) | undefined => {
		if (editing === undefined) return undefined;
		if (removing) return leaveRemoval;
		return onback;
	});
	let editedId = $derived(editing?.id);
	/** The form spreads over two columns; the list and the removal step stay narrow. */
	let formWidth = $derived.by((): 'default' | 'wide' => {
		if (editing === undefined || removing) return 'default';
		return 'wide';
	});

	$effect(() => {
		if (editedId === undefined) {
			removing = false;
			return;
		}
		void tick().then(() => labelInput?.focus());
	});

	function submit(): void {
		if (submittable && !removing) onsubmit();
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
	function enterRemoval(): void {
		replacementId = removalCandidates[0]?.id ?? '';
		removing = true;
	}
	function leaveRemoval(): void {
		removing = false;
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
	width={formWidth}
	oncancel={cancel}
	oncommit={submit}
>
	{#if editing === undefined}
		<ul class="natures" aria-label={m.editing_document_natures_aria()}>
			{#each natures as nature (nature.id)}
				<li>
					<button
						class="nature"
						type="button"
						disabled={busy}
						onclick={() => {
							onselect(nature.id);
						}}
					>
						<span class="swatch" style:background={nature.color}
							><Icon name={nature.icon ?? 'none'} /></span
						>
						<span class="label">{nature.label}</span>
						<span class="usage">{usageLabel(nature.id)}</span>
						<Icon name="phosphor:pencil-simple" />
					</button>
				</li>
			{/each}
		</ul>
		{#if natures.length === 0}<p class="ui-notice warning">
				{m.editing_nature_empty_warning()}
			</p>{/if}
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
						>{#each removalCandidates as candidate (candidate.id)}<option value={candidate.id}
								>{candidate.label}</option
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
			<div class="preview" aria-hidden="true">
				<article class="node-card" style:--content-color={editing.draft.color}>
					<NodeContent
						label={editing.draft.label.trim() || m.common_nature()}
						markdown={m.editing_nature_preview_sample()}
						icon={editing.draft.icon || 'none'}
					/>
				</article>
				<p>{m.editing_preview_caption()}</p>
			</div>
			<div class="controls">
				{#if liveLabel && text}
					{@render text()}
				{:else}
					<label class="ui-label"
						>{m.editing_label()}<input
							class="ui-field"
							aria-label={m.common_nature_label()}
							value={editing.draft.label}
							disabled={busy}
							bind:this={labelInput}
							oninput={(event) => {
								onchange({ label: event.currentTarget.value });
							}}
						/></label
					>
				{/if}
				<ContentStyleEditor
					value={style}
					onchange={(value: ContentStyle) => {
						let icon = value.icon ?? '';
						if (icon === 'none') icon = '';
						onchange({ color: value.color ?? editing.draft.color, icon });
					}}
				/>
				{#if busy}<p role="status">{m.common_change_sent()}</p>{/if}
			</div>
		</form>
	{/if}
	{#snippet footer()}
		{#if editing === undefined}
			<button class="ui-action create" type="button" disabled={busy} onclick={oncreate}>
				<Icon name="phosphor:plus" />
				{m.editing_nature_create()}
			</button>
			<button class="ui-action" type="button" onclick={onclose}>
				<Icon name="phosphor:x" />
				{m.common_close()}
			</button>
		{:else if removing}
			<button class="ui-action" type="button" onclick={leaveRemoval}>
				<Icon name="phosphor:x" />
				{m.common_cancel()}
			</button>
			<button class="ui-action danger" type="button" disabled={!removable} onclick={remove}>
				<Icon name="phosphor:trash" />
				{m.common_delete()}
			</button>
		{:else}
			{#if editing.mode === NatureEditingMode.Edit}
				<button
					class="ui-action quiet remove"
					type="button"
					disabled={busy}
					title={m.editing_nature_delete_hint()}
					onclick={enterRemoval}
				>
					<Icon name="phosphor:trash" />
					{m.common_delete()}
				</button>
			{/if}
			<button class="ui-action" type="button" onclick={onback}>
				<Icon name="phosphor:arrow-left" />
				{#if busy}{m.editing_back()}{:else}{m.common_cancel()}{/if}
			</button>
			<button
				class="ui-action primary"
				type="submit"
				form={`nature-dialog-${formId}`}
				disabled={!submittable}
			>
				{#if editing.mode === NatureEditingMode.Create}<Icon name="phosphor:plus" />
					{m.common_create()}{:else}<Icon name="phosphor:check" />
					{#if busy}{m.common_saving()}{:else}{m.common_save()}{/if}{/if}
			</button>
		{/if}
	{/snippet}
</ModalDialog>

<style>
	.natures {
		display: grid;
		gap: 4px;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.nature {
		display: flex;
		align-items: center;
		gap: 12px;
		width: 100%;
		padding: 8px 10px;
		border: 1px solid transparent;
		border-radius: 10px;
		background: transparent;
		color: var(--ui-text);
		font: inherit;
		text-align: left;
		cursor: pointer;
	}
	.nature:hover:not(:disabled),
	.nature:focus-visible {
		border-color: var(--ui-border);
		background: var(--ui-subtle);
	}
	.nature:focus-visible {
		outline: 2px solid var(--ui-accent);
		outline-offset: 2px;
	}
	.nature:disabled {
		opacity: 0.45;
		cursor: default;
	}
	.swatch {
		display: grid;
		flex: none;
		place-items: center;
		width: 28px;
		height: 28px;
		border-radius: 8px;
		color: var(--content-header-ink);
	}
	.label {
		flex: 1;
		min-width: 0;
		font-weight: 550;
		overflow-wrap: anywhere;
	}
	.usage {
		color: var(--ui-muted);
		font-size: 12px;
	}
	.removal {
		display: grid;
		gap: 16px;
		margin: 0;
	}
	.fields {
		display: grid;
		gap: 24px;
		margin: 0;
	}
	@media (min-width: 641px) {
		.fields {
			grid-template-columns: 220px 1fr;
			align-items: start;
		}
	}
	.preview {
		display: grid;
		gap: 8px;
		justify-items: center;
	}
	.preview p {
		margin: 0;
		color: var(--ui-muted);
		font-size: 11px;
	}
	.node-card {
		width: 100%;
		border: 1px solid color-mix(in srgb, var(--content-color) 35%, #d6d3d1);
		border-radius: 0.75rem;
		background: var(--content-surface);
		box-shadow:
			0 1px 2px rgb(28 25 23 / 0.06),
			0 8px 24px rgb(28 25 23 / 0.06);
		overflow: hidden;
	}
	.controls {
		display: grid;
		gap: 20px;
		min-width: 0;
	}
	.removal p {
		margin: 0;
	}
	.create,
	.remove {
		margin-right: auto;
	}
</style>
