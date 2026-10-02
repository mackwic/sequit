<script lang="ts">
	import type { Snippet } from 'svelte';

	import {
		type ContentStyle,
		contentStyleFields,
		type LayoutLane,
		type LogicNature,
	} from '../../../../../lib/core/document/logic-document';
	import type { NodeFields } from '../../../../../lib/infrastructure/document/node-fields';
	import { NODE_TEXT_PLACEHOLDERS } from '../../../document/node-text';
	import { QuillEditorProfile } from '../../../document/quill-editor-config';
	import { m } from '../../../i18n/paraglide/messages';
	import {
		CANVAS_SHORTCUTS,
		CanvasShortcutId,
		shortcutKeyshortcuts,
	} from '../../canvas/canvas-shortcuts';
	import ContentStyleEditor from '../content/ContentStyleEditor.svelte';
	import MarkdownField from '../content/MarkdownField.svelte';
	import Icon from '../ui/Icon.svelte';
	import Kbd from '../ui/Kbd.svelte';
	import ModalDialog from '../ui/ModalDialog.svelte';

	let {
		mode,
		natures,
		lanes = [],
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
		/** Root lanes in reading order; the selector shows for a top-level box only. */
		lanes?: readonly LayoutLane[];
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
	let nature = $derived(natures.find(({ id }) => id === draft.natureId));
	let submittable = $derived(!busy && !deleted && nature !== undefined);
	let style = $derived<ContentStyle>(
		contentStyleFields(draft.color || undefined, draft.icon || undefined),
	);
	let inherited = $derived.by((): { inherited: ContentStyle } | Record<string, never> => {
		if (nature === undefined) return {};
		return { inherited: contentStyleFields(nature.color, nature.icon) };
	});
	/** What the box will show: its own style, otherwise the nature's. */
	let previewColor = $derived.by(() => {
		if (draft.color !== '') return draft.color;
		return nature?.color ?? '#6366f1';
	});
	let previewIcon = $derived.by(() => {
		if (draft.icon !== '') return draft.icon;
		return nature?.icon ?? 'none';
	});
	let customized = $derived(draft.color !== '' || draft.icon !== '');
	let subtitle = $derived.by((): { description: string } | Record<string, never> => {
		if (description === undefined) return {};
		return { description };
	});
	let title = $derived.by(() => {
		if (mode === 'create') return m.common_new_box();
		return m.editing_node_title_edit();
	});

	function submit(): void {
		if (submittable) onsubmit();
	}
</script>

<ModalDialog
	eyebrow={m.editing_node_eyebrow()}
	{title}
	{...subtitle}
	width="wide"
	{data}
	{onclose}
	oncommit={submit}
>
	<form
		class="fields"
		id={`node-dialog-${formId}`}
		onsubmit={(event) => {
			event.preventDefault();
			submit();
		}}
	>
		<div class="identity">
			<label class="ui-label"
				>{m.common_nature()}<span class="nature">
					<span class="preview" style:--content-color={previewColor} aria-hidden="true"
						><Icon name={previewIcon} size={18} /></span
					><select
						class="ui-field"
						value={draft.natureId}
						disabled={busy}
						onchange={(event) => {
							onchange({ natureId: event.currentTarget.value });
						}}
						>{#each natures as candidate (candidate.id)}<option value={candidate.id}
								>{candidate.label}</option
							>{/each}</select
					></span
				></label
			>
			{#if lanes.length > 0 && draft.laneId !== ''}
				<label class="ui-label"
					>{m.common_lane()}<select
						class="ui-field"
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
		</div>
		{#if natures.length === 0}<p class="ui-notice warning">
				{m.common_nature_required()}
			</p>{/if}
		{#if text}
			{@render text()}
		{:else}
			<MarkdownField
				field="markdown"
				profile={QuillEditorProfile.Body}
				label={m.common_content()}
				placeholder={NODE_TEXT_PLACEHOLDERS.markdown}
				value={draft.markdown}
				disabled={busy}
				autofocus
				onchange={(markdown: string) => {
					onchange({ markdown });
				}}
			/>
			<MarkdownField
				field="description"
				profile={QuillEditorProfile.Description}
				label={m.common_description()}
				placeholder={NODE_TEXT_PLACEHOLDERS.description}
				value={draft.description}
				disabled={busy}
				onchange={(description: string) => {
					onchange({ description });
				}}
			/>
		{/if}
		<details class="style">
			<summary>
				<span class="ui-label">{m.editing_color_and_icon()}</span>
				<span class="current">
					<span class="dot" style:--swatch={previewColor}></span>
					{#if previewIcon !== 'none'}<Icon name={previewIcon} size={14} />{/if}
					{#if customized}{m.editing_customized()}{:else}{m.editing_inherited_nature()}{/if}
					<span class="chevron"><Icon name="phosphor:caret-down" size={14} /></span>
				</span>
			</summary>
			<div class="style-body">
				<ContentStyleEditor
					value={style}
					{...inherited}
					onchange={(value: ContentStyle) => {
						onchange({ color: value.color ?? '', icon: value.icon ?? '' });
					}}
				/>
			</div>
		</details>
		{#if busy}<p role="status">{m.common_change_sent()}</p>{/if}
		{#if diagnostic}<p class="ui-notice error" role="alert">{diagnostic}</p>{/if}
	</form>
	{#snippet footer()}
		<button class="ui-action" type="button" onclick={onclose}>
			<Icon name="phosphor:x" />
			{#if busy}{m.common_close()}{:else}{m.common_cancel()}{/if}
		</button>
		<button
			class="ui-action primary"
			type="submit"
			form={`node-dialog-${formId}`}
			disabled={!submittable}
			aria-keyshortcuts={shortcutKeyshortcuts(confirmShortcut)}
		>
			{#if mode === 'create'}<Icon name="phosphor:plus" /> {m.common_create()}{:else}<Icon
					name="phosphor:check"
				/>
				{#if busy}{m.common_saving()}{:else}{m.common_save()}{/if}{/if}
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
	.identity {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 12px;
	}
	.identity:has(> :nth-child(2)) {
		grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
	}
	.nature {
		display: flex;
		align-items: stretch;
		gap: 8px;
	}
	.nature select {
		min-width: 0;
		flex: 1;
	}
	.preview {
		display: grid;
		flex: none;
		place-items: center;
		width: 36px;
		border: 1px solid color-mix(in srgb, var(--content-color) 35%, var(--ui-border));
		border-radius: 8px;
		background: color-mix(in srgb, var(--content-color) 13%, var(--ui-surface));
		color: var(--content-color);
	}
	.style {
		border: 1px solid var(--ui-border);
		border-radius: 8px;
		background: var(--ui-surface);
	}
	.style summary {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 10px 12px;
		border-radius: 8px;
		cursor: pointer;
		list-style: none;
	}
	.style summary::-webkit-details-marker {
		display: none;
	}
	.style summary:hover {
		background: var(--ui-subtle);
	}
	.style summary:focus-visible {
		outline: 2px solid var(--ui-accent);
		outline-offset: -2px;
	}
	.style[open] summary {
		border-bottom: 1px solid var(--ui-border);
		border-radius: 8px 8px 0 0;
	}
	.current {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		color: var(--ui-muted);
		font-size: 12px;
	}
	.dot {
		width: 12px;
		height: 12px;
		border: 1px solid #0002;
		border-radius: 50%;
		background: var(--swatch);
	}
	.chevron {
		display: inline-flex;
		margin-left: 4px;
		transition: transform 120ms ease;
	}
	.style[open] .chevron {
		transform: rotate(180deg);
	}
	.style-body {
		padding: 14px 12px;
	}
	@media (max-width: 640px) {
		.identity:has(> :nth-child(2)) {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
