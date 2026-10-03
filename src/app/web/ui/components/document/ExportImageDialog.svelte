<script lang="ts">
	import { onMount, untrack } from 'svelte';

	import { captureDocumentExport, captureImageCopy } from '../../../analytics/analytics';
	import { m } from '../../../i18n/paraglide/messages';
	import {
		type CanvasImage,
		canvasSelectedKeys,
		EXPORT_SCALES,
		type ExportScale,
		rasterizeCanvasImage,
		renderCanvasImage,
	} from '../../canvas/canvas-image';
	import { downloadBlob } from '../../document/download-text';
	import Icon from '../ui/Icon.svelte';
	import ModalDialog from '../ui/ModalDialog.svelte';
	import ToggleSwitch from '../ui/ToggleSwitch.svelte';

	let {
		stage,
		stem,
		onclose,
	}: {
		/** The rendered stage to picture. */
		stage: HTMLElement;
		/** The proposed file name, without extension. */
		stem: string;
		onclose: () => void;
	} = $props();
	const id = $props.id();
	const NOTICE_MS = 2000;
	const selection = untrack(() => canvasSelectedKeys(stage));
	let canCopy = $state(false);
	let selectionOnly = $state(untrack(() => selection.size > 0));
	let background = $state(true);
	let scale = $state<ExportScale>(2);
	let filename = $state(untrack(() => stem));
	let image = $state<CanvasImage>();
	let busy = $state(false);
	let notice = $state<{ kind: 'done' | 'error'; text: string }>();
	let noticeTimer: ReturnType<typeof setTimeout> | undefined;
	let generation = 0;
	let previewUrl = $derived.by(() => {
		if (image === undefined) return undefined;
		return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(image.svg)}`;
	});
	let pixelSize = $derived.by(() => {
		if (image === undefined) return undefined;
		return m.document_export_pixel_size({
			width: image.size.width * scale,
			height: image.size.height * scale,
		});
	});
	let name = $derived(filename.trim() || stem);

	$effect(() => {
		let selected: ReadonlySet<string> | undefined;
		if (selectionOnly) selected = selection;
		const options = { selection: selected, background };
		const current = ++generation;
		void renderCanvasImage(stage, options)
			.then((rendered) => {
				if (current === generation) image = rendered;
			})
			.catch(() => {
				if (current === generation) announce('error', m.document_export_render_error());
			});
	});

	onMount(() => {
		canCopy = typeof ClipboardItem !== 'undefined';
		return () => {
			clearTimeout(noticeTimer);
		};
	});

	function announce(kind: 'done' | 'error', text: string): void {
		notice = { kind, text };
		clearTimeout(noticeTimer);
		noticeTimer = setTimeout(() => {
			notice = undefined;
		}, NOTICE_MS);
	}

	async function perform(
		action: (picture: CanvasImage) => Promise<void>,
		done: string,
	): Promise<void> {
		if (image === undefined || busy) return;
		busy = true;
		try {
			await action(image);
			announce('done', done);
		} catch {
			announce('error', m.document_export_failed());
		} finally {
			busy = false;
		}
	}

	function downloadPng(): void {
		void perform(async (picture) => {
			const file = `${name}.png`;
			downloadBlob(await rasterizeCanvasImage(picture, scale), file);
			captureDocumentExport(file);
		}, m.document_export_png_downloaded());
	}

	function downloadSvg(): void {
		void perform((picture) => {
			const file = `${name}.svg`;
			downloadBlob(new Blob([picture.svg], { type: 'image/svg+xml;charset=utf-8' }), file);
			captureDocumentExport(file);
			return Promise.resolve();
		}, m.document_export_svg_downloaded());
	}

	function copy(): void {
		// Safari only honours a clipboard write started in the gesture: the item carries the pending PNG.
		void perform(
			(picture) =>
				navigator.clipboard
					.write([new ClipboardItem({ 'image/png': rasterizeCanvasImage(picture, scale) })])
					.then(captureImageCopy),
			m.document_export_copied(),
		);
	}
</script>

<ModalDialog
	title={m.document_export_title()}
	width="wide"
	data={{ 'data-export-image-dialog': '' }}
	{onclose}
	oncommit={downloadPng}
>
	<div class="layout">
		<div class="preview-column">
			<div class="preview" class:transparent={!background} data-export-preview>
				{#if previewUrl !== undefined}
					<img src={previewUrl} alt={m.document_export_preview_alt()} />
				{:else}
					<p class="m-0 text-sm text-[var(--ui-muted)]">{m.document_export_preview_loading()}</p>
				{/if}
			</div>
			<label class="ui-label" for={`export-name-${id}`}
				>{m.document_export_filename()}<input
					class="ui-field"
					id={`export-name-${id}`}
					type="text"
					autocomplete="off"
					spellcheck="false"
					bind:value={filename}
				/></label
			>
		</div>
		<div class="options">
			<ToggleSwitch
				label={m.document_export_selection_only()}
				checked={selectionOnly}
				disabled={selection.size === 0}
				onchange={(value: boolean) => {
					selectionOnly = value;
				}}
			/>
			<ToggleSwitch
				label={m.document_export_background()}
				checked={background}
				onchange={(value: boolean) => {
					background = value;
				}}
			/>
			<div class="scale">
				<span class="label" id={`export-scale-${id}`}>{m.document_export_scale()}</span>
				<div class="segments" role="radiogroup" aria-labelledby={`export-scale-${id}`}>
					{#each EXPORT_SCALES as option (option)}
						<button
							type="button"
							role="radio"
							aria-checked={scale === option}
							onclick={() => {
								scale = option;
							}}>{m.document_export_scale_option({ option })}</button
						>
					{/each}
				</div>
			</div>
			<p class="m-0 text-xs text-[var(--ui-muted)]" data-export-size>
				{#if pixelSize !== undefined}{pixelSize}{:else}&nbsp;{/if}
			</p>
		</div>
	</div>
	{#snippet footer()}
		<p class="status" class:error={notice?.kind === 'error'} role="status" aria-live="polite">
			{notice?.text ?? ''}
		</p>
		<button
			class="ui-action primary"
			type="button"
			disabled={image === undefined || busy}
			onclick={downloadPng}
		>
			<Icon name="phosphor:download-simple" />
			{m.document_export_download_png()}
		</button>
		<button
			class="ui-action primary"
			type="button"
			disabled={image === undefined || busy}
			onclick={downloadSvg}
		>
			<Icon name="phosphor:download-simple" />
			{m.document_export_download_svg()}
		</button>
		{#if canCopy}
			<button
				class="ui-action primary"
				type="button"
				disabled={image === undefined || busy}
				onclick={copy}
			>
				<Icon name="phosphor:copy" />
				{m.document_export_copy()}
			</button>
		{/if}
	{/snippet}
</ModalDialog>

<style>
	.layout {
		display: grid;
		grid-template-columns: minmax(0, 3fr) minmax(14rem, 2fr);
		gap: 24px;
	}
	.preview-column {
		display: grid;
		gap: 12px;
		align-content: start;
	}
	.preview {
		position: relative;
		display: grid;
		place-items: center;
		aspect-ratio: 4 / 3;
		overflow: hidden;
		border: 1px solid var(--ui-border);
		border-radius: 12px;
		background: var(--ui-subtle);
	}
	.preview.transparent {
		background-color: #fff;
		background-image:
			linear-gradient(45deg, #e5e5e5 25%, transparent 25%, transparent 75%, #e5e5e5 75%),
			linear-gradient(45deg, #e5e5e5 25%, transparent 25%, transparent 75%, #e5e5e5 75%);
		background-position:
			0 0,
			8px 8px;
		background-size: 16px 16px;
	}
	/* Pinned to the box: a grid track would grow with the picture instead of shrinking it. */
	.preview img {
		position: absolute;
		inset: 0;
		box-sizing: border-box;
		width: 100%;
		height: 100%;
		padding: 16px;
		object-fit: contain;
	}
	.options {
		display: grid;
		gap: 18px;
		align-content: start;
	}
	.scale {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
	}
	.label {
		font-size: 14px;
		font-weight: 550;
	}
	.segments {
		display: inline-flex;
		gap: 2px;
		padding: 2px;
		border: 1px solid var(--ui-border);
		border-radius: 8px;
		background: var(--ui-subtle);
	}
	.segments button {
		min-width: 2.5rem;
		padding: 4px 8px;
		border: 0;
		border-radius: 6px;
		background: transparent;
		color: var(--ui-muted);
		font-size: 13px;
		font-weight: 600;
		cursor: pointer;
	}
	.segments button:hover {
		color: var(--ui-text);
	}
	.segments button[aria-checked='true'] {
		background: var(--ui-accent);
		color: var(--ui-on-accent);
	}
	.segments button:focus-visible {
		outline: 2px solid var(--ui-accent);
		outline-offset: 1px;
	}
	.status {
		flex: 1;
		align-self: center;
		margin: 0;
		min-width: 8rem;
		color: var(--ui-muted);
		font-size: 12px;
	}
	.status.error {
		color: var(--ui-danger);
	}
	@media (max-width: 640px) {
		.layout {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
