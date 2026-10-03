<script lang="ts">
	import type { LogicDocument } from '../../../../../lib/core/document/logic-document';
	import { serializeLogicDocumentDot } from '../../../../../lib/infrastructure/dot/serialize-logic-document-dot';
	import { serializeSequitToml } from '../../../../../lib/infrastructure/toml/serialize-sequit-toml';
	import { captureDocumentExport } from '../../../analytics/analytics';
	import { m } from '../../../i18n/paraglide/messages';
	import type { CanvasModel } from '../../canvas/canvas-model';
	import { documentFilename, documentFileStem } from '../../document/document-filename';
	import { downloadBlob, downloadText } from '../../document/download-text';
	import { serializeExcalidraw } from '../../document/export-excalidraw';
	import Icon from '../ui/Icon.svelte';
	import ModalDialog from '../ui/ModalDialog.svelte';

	let {
		document,
		canvas,
		onTomlDownloaded,
		onclose,
	}: {
		/** A document snapshot captured when Export was opened. */
		document: LogicDocument;
		/** The matching laid-out scene, when the canvas has completed projection. */
		canvas: CanvasModel | undefined;
		onTomlDownloaded?: (() => void) | undefined;
		onclose: () => void;
	} = $props();
	let failed = $state(false);
	let stem = $derived(documentFileStem(document.title, document.id));

	function download(action: () => void): void {
		try {
			action();
			onclose();
		} catch {
			failed = true;
		}
	}

	function downloadToml(): void {
		download(() => {
			const filename = documentFilename(document.title, document.id);
			downloadText(serializeSequitToml(document), filename);
			captureDocumentExport(filename);
			onTomlDownloaded?.();
		});
	}

	function downloadDot(): void {
		download(() => {
			const filename = `${stem}.dot`;
			downloadText(serializeLogicDocumentDot(document), filename);
			captureDocumentExport(filename);
		});
	}

	function downloadExcalidraw(): void {
		if (canvas === undefined) return;
		download(() => {
			const filename = `${stem}.excalidraw`;
			downloadBlob(
				new Blob([serializeExcalidraw(document, canvas)], {
					type: 'application/json;charset=utf-8',
				}),
				filename,
			);
			captureDocumentExport(filename);
		});
	}
</script>

<ModalDialog
	title={m.document_export_document_title()}
	data={{ 'data-export-document-dialog': '' }}
	{onclose}
>
	<div class="formats">
		<button type="button" class="format" onclick={downloadToml}>
			<Icon name="phosphor:file-text" />
			<span>
				<strong>{m.document_export_format_sequit()}</strong>
				<small>{m.document_export_format_sequit_description()}</small>
			</span>
		</button>
		<button type="button" class="format" onclick={downloadDot}>
			<Icon name="phosphor:graph" />
			<span>
				<strong>{m.document_export_format_dot()}</strong>
				<small>{m.document_export_format_dot_description()}</small>
			</span>
		</button>
		<button
			type="button"
			class="format"
			disabled={canvas === undefined}
			onclick={downloadExcalidraw}
		>
			<Icon name="phosphor:shapes" />
			<span>
				<strong>{m.document_export_format_excalidraw()}</strong>
				<small>{m.document_export_format_excalidraw_description()}</small>
			</span>
		</button>
	</div>
	{#if canvas === undefined}
		<p class="note">{m.document_export_excalidraw_requires_layout()}</p>
	{/if}
	{#if failed}<p role="alert" class="error">{m.document_export_failed()}</p>{/if}
	{#snippet footer()}
		<button class="ui-action" type="button" onclick={onclose}>
			<Icon name="phosphor:x" />{m.common_cancel()}
		</button>
	{/snippet}
</ModalDialog>

<style>
	.formats {
		display: grid;
		gap: 8px;
	}
	.format {
		display: flex;
		align-items: center;
		gap: 12px;
		width: 100%;
		padding: 12px;
		border: 1px solid var(--ui-border);
		border-radius: 10px;
		background: var(--ui-surface);
		color: var(--ui-text);
		text-align: left;
		cursor: pointer;
	}
	.format:hover:not(:disabled),
	.format:focus-visible {
		border-color: var(--ui-accent);
		background: var(--ui-subtle);
	}
	.format:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.format span {
		display: grid;
		gap: 2px;
	}
	.format strong {
		font-size: 14px;
	}
	.format small,
	.note {
		color: var(--ui-muted);
		font-size: 12px;
	}
	.note,
	.error {
		margin: 0;
	}
	.error {
		color: var(--ui-danger);
	}
</style>
