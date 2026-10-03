<script lang="ts">
	import { onMount, untrack } from 'svelte';

	import { m } from '../../../i18n/paraglide/messages';
	import Icon from '../ui/Icon.svelte';

	let {
		title,
		onrename,
		onclose,
	}: {
		title: string;
		/** Receives a new, trimmed and non-empty title. */
		onrename: (title: string) => void;
		/** The field is done; `restoreFocus` when the keyboard ended it rather than a click elsewhere. */
		onclose: (restoreFocus: boolean) => void;
	} = $props();

	let input = $state<HTMLInputElement>();
	let draft = $state(untrack(() => title));
	let closed = false;

	// The whole title starts selected: typing replaces it.
	onMount(() => {
		input?.focus();
		input?.select();
	});

	function finish(save: boolean, restoreFocus: boolean): void {
		if (closed) return;
		closed = true;
		const next = draft.trim();
		// An emptied title is a slip, not a name: the document keeps its current one.
		if (save && next !== '' && next !== title) onrename(next);
		onclose(restoreFocus);
	}

	function keydown(event: KeyboardEvent): void {
		if (event.isComposing) return;
		if (event.key !== 'Enter' && event.key !== 'Escape') return;
		event.preventDefault();
		finish(event.key === 'Enter', true);
	}
</script>

<!-- The frame takes the menu trigger's place and box: the title text does not move. -->
<span class="field">
	<Icon name="phosphor:pencil-simple" size={18} />
	<span class="sizer" data-value={draft}>
		<input
			bind:this={input}
			bind:value={draft}
			type="text"
			aria-label={m.common_document_title()}
			autocomplete="off"
			enterkeyhint="done"
			onblur={() => {
				finish(true, false);
			}}
			onkeydown={keydown}
		/>
	</span>
</span>

<style>
	.field {
		display: inline-flex;
		min-width: 0;
		align-items: center;
		gap: 8px;
		border: 1px solid var(--ui-accent);
		border-radius: 8px;
		padding: 5px 9px 5px 7px;
		background: var(--ui-surface);
		box-shadow: 0 0 0 3px var(--ui-accent-soft);
		color: var(--ui-accent);
	}
	.sizer {
		display: inline-grid;
		min-width: 0;
		max-width: min(40vw, 26rem);
	}
	/* An invisible copy of the text sizes the field to its content, up to the maximum width. */
	.sizer::after,
	input {
		grid-area: 1 / 1;
		border: 0;
		padding: 0;
		font: inherit;
		font-size: 14px;
		font-weight: 550;
	}
	.sizer::after {
		content: attr(data-value) ' ';
		overflow: hidden;
		block-size: 0;
		visibility: hidden;
		white-space: pre;
	}
	input {
		min-width: 8ch;
		width: 100%;
		background: transparent;
		color: var(--ui-text);
		outline: none;
	}
	/* iOS Safari zooms the page into a field whose text is under 16px when it gets focus. */
	@media (hover: none) {
		.sizer::after,
		input {
			font-size: 16px;
		}
	}
</style>
