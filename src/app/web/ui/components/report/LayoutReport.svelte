<script lang="ts">
	import { untrack } from 'svelte';

	import {
		LAYOUT_REPORT_CATEGORIES,
		LAYOUT_REPORT_MAX_COMMENT_LENGTH,
		LayoutReportCategory,
	} from '../../../../../lib/infrastructure/layout-report/layout-report';
	import { m } from '../../../i18n/paraglide/messages';
	import type { LayoutMeasurements } from '../../../projection/layout-graph';
	import type { CanvasModel } from '../../canvas/canvas-model';
	import { CANVAS_SHORTCUTS, CanvasShortcutId } from '../../canvas/canvas-shortcuts';
	import {
		browserEnvironment,
		captureLayoutReport,
		type LayoutReportRequest,
	} from '../../report/capture-layout-report';
	import type { ReportZone } from '../../report/report-zones';
	import { submitLayoutReport } from '../../report/submit-layout-report';
	import Icon from '../ui/Icon.svelte';
	import Kbd from '../ui/Kbd.svelte';
	import ModalDialog from '../ui/ModalDialog.svelte';
	import LayoutReportPointing from './LayoutReportPointing.svelte';

	let {
		request,
		canvas,
		viewport,
		failure,
		measure,
	}: {
		request: LayoutReportRequest;
		/** The canvas shown, if any; pointing needs it. */
		canvas: CanvasModel | undefined;
		viewport: HTMLDivElement | undefined;
		/** The failure shown instead of a canvas. */
		failure: string | undefined;
		/** The measurements the canvas is laid out with, read when the report leaves. */
		measure: () => LayoutMeasurements;
	} = $props();
	const formId = $props.id();
	const confirmShortcut = CANVAS_SHORTCUTS[CanvasShortcutId.Confirm];
	const labels: Record<LayoutReportCategory, () => string> = {
		[LayoutReportCategory.Overlap]: () => m.feedback_category_overlap(),
		[LayoutReportCategory.Crossing]: () => m.feedback_category_crossing(),
		[LayoutReportCategory.Route]: () => m.feedback_category_route(),
		[LayoutReportCategory.Spacing]: () => m.feedback_category_spacing(),
		[LayoutReportCategory.Order]: () => m.feedback_category_order(),
		[LayoutReportCategory.Failure]: () => m.feedback_category_failure(),
		[LayoutReportCategory.Other]: () => m.feedback_category_other(),
	};
	function initialCategory(): LayoutReportCategory | undefined {
		if (failure === undefined) return undefined;
		return LayoutReportCategory.Failure;
	}
	let category = $state(untrack(initialCategory));
	let comment = $state('');
	let zones = $state.raw<readonly ReportZone[]>([]);
	let pointing = $state(false);
	let status = $state<'editing' | 'sending' | 'sent' | 'failed'>('editing');
	let sentId = $state('');
	let busy = $derived(status === 'sending' || status === 'sent');

	async function send(): Promise<void> {
		if (category === undefined || busy) return;
		status = 'sending';
		try {
			const report = await captureLayoutReport({
				document: request.read(),
				measurements: measure(),
				canvas,
				failure,
				viewport,
				zones,
				category,
				comment,
				environment: browserEnvironment(),
			});
			const submission = await submitLayoutReport(report);
			if (!submission.ok) {
				status = 'failed';
				return;
			}
			sentId = submission.id;
			status = 'sent';
		} catch {
			status = 'failed';
		}
	}
</script>

{#if pointing && canvas && viewport}
	<LayoutReportPointing
		{canvas}
		{viewport}
		{zones}
		onzone={(zone: ReportZone) => {
			zones = [...zones, zone];
		}}
		ondone={() => {
			pointing = false;
		}}
	/>
{:else}
	<ModalDialog
		eyebrow={m.feedback_report_eyebrow()}
		title={m.feedback_report_title()}
		description={m.feedback_report_description()}
		width="wide"
		data={{ 'data-layout-report': '' }}
		onclose={request.close}
		oncommit={() => void send()}
	>
		<form
			class="fields"
			id={`layout-report-${formId}`}
			onsubmit={(event) => {
				event.preventDefault();
				void send();
			}}
		>
			<fieldset class="categories" disabled={busy}>
				<legend class="ui-label">{m.feedback_category_legend()}</legend>
				{#each LAYOUT_REPORT_CATEGORIES as candidate (candidate)}
					<label class="category" class:checked={candidate === category}>
						<input
							type="radio"
							name={`layout-report-category-${formId}`}
							value={candidate}
							checked={candidate === category}
							onchange={() => {
								category = candidate;
							}}
						/>
						{labels[candidate]()}
					</label>
				{/each}
			</fieldset>
			<label class="ui-label">
				{m.feedback_comment_label()}
				<textarea
					class="ui-field"
					rows="4"
					maxlength={LAYOUT_REPORT_MAX_COMMENT_LENGTH}
					placeholder={m.feedback_comment_placeholder()}
					disabled={busy}
					bind:value={comment}></textarea>
			</label>
			<div class="zones">
				<span class="ui-label">{m.feedback_zones_label()}</span>
				<p data-report-zone-count={zones.length}>
					{#if zones.length === 0}{m.feedback_zones_none()}{:else}{m.feedback_zones_count({
							count: zones.length,
						})}{/if}
				</p>
				<div class="zone-actions">
					<button
						class="ui-action"
						type="button"
						disabled={busy || !canvas || !viewport}
						onclick={() => {
							pointing = true;
						}}
					>
						<Icon name="phosphor:crosshair" />
						{m.feedback_point()}
					</button>
					{#if zones.length > 0}
						<button
							class="ui-action quiet"
							type="button"
							disabled={busy}
							onclick={() => {
								zones = [];
							}}
						>
							{m.feedback_zones_clear()}
						</button>
					{/if}
				</div>
			</div>
			<p class="privacy">{m.feedback_privacy()}</p>
			{#if status === 'sent'}
				<p class="ui-notice" role="status" data-layout-report-sent={sentId}>
					{m.feedback_sent({ id: sentId })}
				</p>
			{:else if status === 'failed'}
				<p class="ui-notice error" role="alert">{m.feedback_failed()}</p>
			{/if}
		</form>
		{#snippet footer()}
			<button class="ui-action" type="button" onclick={request.close}>
				<Icon name="phosphor:x" />
				{#if status === 'sent'}{m.common_close()}{:else}{m.common_cancel()}{/if}
			</button>
			{#if status !== 'sent'}
				<button
					class="ui-action primary"
					type="submit"
					form={`layout-report-${formId}`}
					disabled={category === undefined || busy}
				>
					<Icon name="phosphor:paper-plane-tilt" />
					{#if status === 'sending'}{m.feedback_sending()}{:else}{m.feedback_send()}{/if}
					<Kbd shortcut={confirmShortcut} />
				</button>
			{/if}
		{/snippet}
	</ModalDialog>
{/if}

<style>
	.fields {
		display: grid;
		gap: 16px;
		margin: 0;
	}
	.categories {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin: 0;
		padding: 0;
		border: 0;
	}
	.categories legend {
		margin-bottom: 8px;
	}
	.category {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 6px 10px;
		border: 1px solid var(--ui-border);
		border-radius: 999px;
		font-size: 13px;
		cursor: pointer;
	}
	.category.checked {
		border-color: var(--ui-accent);
		background: color-mix(in srgb, var(--ui-accent) 8%, transparent);
	}
	.zones {
		display: grid;
		gap: 6px;
	}
	.zones p {
		margin: 0;
		color: var(--ui-muted);
		font-size: 13px;
	}
	.zone-actions {
		display: flex;
		gap: 8px;
	}
	.privacy {
		margin: 0;
		color: var(--ui-muted);
		font-size: 12px;
	}
</style>
