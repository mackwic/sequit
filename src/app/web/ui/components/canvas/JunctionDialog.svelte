<script lang="ts">
	import { onMount, tick } from 'svelte';

	import {
		JUNCTION_OPERATORS,
		type JunctionOperator,
	} from '../../../../../lib/core/document/logic-document';
	import { m } from '../../../i18n/paraglide/messages';
	import {
		CANVAS_SHORTCUTS,
		CanvasShortcutId,
		shortcutKeyshortcuts,
	} from '../../canvas/canvas-shortcuts';
	import Icon from '../ui/Icon.svelte';
	import Kbd from '../ui/Kbd.svelte';
	import ModalDialog from '../ui/ModalDialog.svelte';

	let {
		operator,
		onchange,
		onsubmit,
		onclose,
		busy = false,
		description,
		data = {},
	}: {
		operator: JunctionOperator;
		onchange: (operator: JunctionOperator) => void;
		onsubmit: () => void;
		/** Cancel keeps the junction with its last saved operator. */
		onclose: () => void;
		busy?: boolean;
		description?: string | undefined;
		data?: Record<`data-${string}`, string>;
	} = $props();
	const formId = $props.id();
	const confirmShortcut = CANVAS_SHORTCUTS[CanvasShortcutId.Confirm];
	const labels: Record<
		JunctionOperator,
		{ readonly title: () => string; readonly hint: () => string; readonly symbol: () => string }
	> = {
		and: {
			title: () => m.editing_junction_and(),
			hint: () => m.editing_junction_and_hint(),
			symbol: () => m.editing_junction_symbol_and(),
		},
		or: {
			title: () => m.editing_junction_or(),
			hint: () => m.editing_junction_or_hint(),
			symbol: () => m.editing_junction_symbol_or(),
		},
		xor: {
			title: () => m.editing_junction_xor(),
			hint: () => m.editing_junction_xor_hint(),
			symbol: () => m.editing_junction_symbol_xor(),
		},
	};
	let operators = $state<HTMLFieldSetElement>();
	let subtitle = $derived.by((): { description: string } | Record<string, never> => {
		if (description === undefined) return {};
		return { description };
	});

	onMount(() => {
		void tick().then(() => {
			operators?.querySelector<HTMLInputElement>('input:checked')?.focus();
		});
	});

	function submit(): void {
		if (!busy) onsubmit();
	}
</script>

<ModalDialog
	eyebrow={m.common_junction()}
	title={m.editing_junction_title()}
	{...subtitle}
	{data}
	{onclose}
	oncommit={submit}
>
	<form
		class="fields"
		id={`junction-dialog-${formId}`}
		onsubmit={(event) => {
			event.preventDefault();
			submit();
		}}
	>
		<fieldset class="operators" disabled={busy} bind:this={operators}>
			<legend class="ui-label">{m.common_operator()}</legend>
			{#each JUNCTION_OPERATORS as candidate (candidate)}
				{@const checked = candidate === operator}
				<label class="operator" class:checked>
					<input
						type="radio"
						name={`junction-operator-${formId}`}
						value={candidate}
						aria-label={labels[candidate].title()}
						{checked}
						onchange={() => {
							onchange(candidate);
						}}
					/>
					<span class="symbol">{labels[candidate].symbol()}</span>
					<span class="text">
						<strong>{labels[candidate].title()}</strong>
						<span class="hint">{labels[candidate].hint()}</span>
					</span>
				</label>
			{/each}
		</fieldset>
		{#if busy}<p role="status">{m.common_change_sent()}</p>{/if}
	</form>
	{#snippet footer()}
		<button class="ui-action" type="button" onclick={onclose}>
			<Icon name="phosphor:x" />
			{#if busy}{m.common_close()}{:else}{m.common_cancel()}{/if}
		</button>
		<button
			class="ui-action primary"
			type="submit"
			form={`junction-dialog-${formId}`}
			disabled={busy}
			aria-keyshortcuts={shortcutKeyshortcuts(confirmShortcut)}
		>
			<Icon name="phosphor:check" />
			{#if busy}{m.common_saving()}{:else}{m.common_save()}{/if}
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
	.operators {
		display: grid;
		gap: 8px;
		margin: 0;
		padding: 0;
		border: 0;
	}
	.operator {
		display: grid;
		grid-template-columns: auto auto 1fr;
		align-items: center;
		gap: 12px;
		padding: 10px 12px;
		border: 1px solid var(--ui-border);
		border-radius: 10px;
		cursor: pointer;
	}
	.operator.checked {
		border-color: var(--ui-accent);
		background: color-mix(in srgb, var(--ui-accent) 8%, transparent);
	}
	.symbol {
		min-width: 2.6rem;
		padding: 2px 6px;
		border: 1px solid #57534e;
		border-radius: 999px;
		background: #facc15;
		color: #292524;
		font-size: 11px;
		font-weight: 700;
		text-align: center;
	}
	.text {
		display: grid;
		gap: 2px;
		font-size: 13px;
	}
	.hint {
		color: var(--ui-muted);
		font-size: 12px;
	}
</style>
