<script lang="ts">
	import { onMount, type Snippet } from 'svelte';

	import {
		CANVAS_SHORTCUTS,
		CanvasShortcutId,
		matchesShortcut,
	} from '../../canvas/canvas-shortcuts';

	let {
		title,
		eyebrow,
		description,
		width = 'default',
		data = {},
		onclose,
		oncancel,
		oncommit,
		children,
		footer,
	}: {
		title: string;
		eyebrow?: string;
		description?: string;
		width?: 'default' | 'wide';
		/** `data-*` hooks forwarded to the `<dialog>` element. */
		data?: Record<`data-${string}`, string>;
		/** Backdrop click, and Escape unless `oncancel` is given. */
		onclose: () => void;
		/** Escape, when it must differ from `onclose`. */
		oncancel?: (() => void) | undefined;
		/** Confirm (Shift+Enter) anywhere in the dialog, captured before the focused field. */
		oncommit?: (() => void) | undefined;
		children: Snippet;
		footer?: Snippet;
	} = $props();
	const id = $props.id();
	let dialog: HTMLDialogElement;
	let destroyed = false;
	let pressedBackdrop = false;
	let releasedBackdrop = false;
	let describedBy = $derived.by(() => {
		if (description === undefined) return undefined;
		return `modal-description-${id}`;
	});

	onMount(() => {
		dialog.showModal();
		return () => {
			destroyed = true;
			dialog.close();
		};
	});

	function cancel(event: Event): void {
		event.preventDefault();
		(oncancel ?? onclose)();
	}

	function closed(): void {
		// The platform may close without a cancelable `cancel` event.
		if (!destroyed) onclose();
	}

	function clickBackdrop(event: MouseEvent): void {
		// A click targets the common ancestor of press and release: require both on the backdrop.
		if (pressedBackdrop && releasedBackdrop && event.target === dialog) onclose();
		pressedBackdrop = false;
		releasedBackdrop = false;
	}

	function commit(event: KeyboardEvent): void {
		if (
			oncommit === undefined ||
			!matchesShortcut(CANVAS_SHORTCUTS[CanvasShortcutId.Confirm], event)
		)
			return;
		event.preventDefault();
		event.stopPropagation();
		oncommit();
	}

	function tabbable(element: HTMLElement): boolean {
		// `checkVisibility` also excludes the content of a closed `<details>`, which keeps
		// zero-sized client rects under `content-visibility: hidden`.
		return element.tabIndex >= 0 && !element.matches(':disabled') && element.checkVisibility();
	}

	function containFocus(event: KeyboardEvent): void {
		if (event.key !== 'Tab' || event.defaultPrevented) return;
		const controls = [
			...dialog.querySelectorAll<HTMLElement>(
				'a[href], button, input, select, textarea, summary, [tabindex], [contenteditable="true"]',
			),
		].filter(tabbable);
		if (controls.length === 0) return;
		const current = controls.findIndex((control) => control === document.activeElement);
		let next = 0;
		if (event.shiftKey) next = controls.length - 1;
		if (current >= 0) {
			let step = 1;
			if (event.shiftKey) step = -1;
			next = (current + step + controls.length) % controls.length;
		}
		// Include buttons even when the platform's native Tab preference skips them.
		event.preventDefault();
		controls[next]?.focus();
	}
</script>

<dialog
	class:wide={width === 'wide'}
	aria-modal="true"
	aria-labelledby={`modal-title-${id}`}
	aria-describedby={describedBy}
	{...data}
	bind:this={dialog}
	oncancel={cancel}
	onclose={closed}
	onpointerdown={(event) => {
		pressedBackdrop = event.target === dialog;
	}}
	onpointerup={(event) => {
		releasedBackdrop = event.target === dialog;
	}}
	onclick={clickBackdrop}
	onkeydown={containFocus}
	onkeydowncapture={commit}
>
	<header>
		{#if eyebrow !== undefined}<p class="eyebrow">{eyebrow}</p>{/if}
		<h2 id={`modal-title-${id}`}>{title}</h2>
		{#if description !== undefined}<p class="description" id={`modal-description-${id}`}>
				{description}
			</p>{/if}
	</header>
	<div class="body">{@render children()}</div>
	{#if footer}<footer>{@render footer()}</footer>{/if}
</dialog>

<style>
	dialog {
		pointer-events: auto;
		width: min(34rem, calc(100vw - 2rem));
		max-width: none;
		max-height: calc(100dvh - 2rem);
		margin: auto;
		padding: 0;
		overflow: hidden;
		border: 1px solid var(--ui-border);
		border-radius: 16px;
		background: var(--ui-surface);
		color: var(--ui-text);
		box-shadow:
			var(--ui-shadow),
			0 24px 64px color-mix(in srgb, var(--ui-text) 22%, transparent);
	}
	dialog[open] {
		display: flex;
		flex-direction: column;
	}
	dialog.wide {
		width: min(48rem, calc(100vw - 2rem));
	}
	dialog::backdrop {
		background: color-mix(in srgb, var(--ui-text) 55%, transparent);
		backdrop-filter: blur(2px);
	}
	header,
	footer {
		flex-shrink: 0;
		padding: 18px 24px;
		background: var(--ui-subtle);
	}
	header {
		border-bottom: 1px solid var(--ui-border);
	}
	footer {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 8px;
		padding-block: 14px;
		border-top: 1px solid var(--ui-border);
	}
	.eyebrow {
		margin: 0 0 4px;
		color: var(--ui-muted);
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}
	h2 {
		margin: 0;
		font-size: 20px;
		font-weight: 650;
		overflow-wrap: anywhere;
	}
	.description {
		margin: 4px 0 0;
		color: var(--ui-muted);
		font-size: 13px;
	}
	.body {
		display: grid;
		flex: 1;
		align-content: start;
		gap: 16px;
		min-height: 0;
		overflow: auto;
		padding: 20px 24px;
	}
	@media (max-width: 640px) {
		header,
		.body,
		footer {
			padding-inline: 16px;
		}
	}
</style>
