<script lang="ts">
	import {
		LAYOUT_DIRECTIONS,
		type LayoutConfiguration,
		type LayoutLane,
	} from '../../../../../lib/core/document/logic-document';
	import {
		LAYOUT_SIDES,
		layoutChoice,
		layoutDirectionIcons,
		layoutSide,
		layoutSideLabels,
	} from '../../canvas/layout-choice';
	import { layoutDirectionLabels } from '../../canvas/layout-direction-labels';
	import DropdownMenu from '../ui/DropdownMenu.svelte';
	import Icon from '../ui/Icon.svelte';

	let {
		layout,
		lanes = [],
		disabled = false,
		onchange,
		onlanes,
	}: {
		layout: LayoutConfiguration;
		/** Root lanes in reading order; summarised in the chip. */
		lanes?: readonly LayoutLane[];
		disabled?: boolean;
		/** Receives the whole configuration: direction and bias always travel together. */
		onchange: (layout: LayoutConfiguration) => void;
		/** Opens the lanes dialog; absent when lanes cannot be edited here. */
		onlanes?: (() => void) | undefined;
	} = $props();
	let side = $derived(layoutSide(layout));
	let laneSummary = $derived.by(() => {
		if (lanes.length === 0) return 'Sans lanes';
		return `${lanes.length} lanes`;
	});

	function caretIcon(open: boolean): string {
		if (open) return 'phosphor:caret-up';
		return 'phosphor:caret-down';
	}
</script>

<div class="layout-chip" data-layout-chip>
	<DropdownMenu label="Mise en page" {disabled}>
		{#snippet trigger(open)}
			<Icon name={layoutDirectionIcons[layout.direction]} size={14} />
			<span>{layoutDirectionLabels[layout.direction]}</span>
			{#if lanes.length > 0}<span class="lanes">· {laneSummary}</span>{/if}
			<Icon name={caretIcon(open === true)} size={12} />
		{/snippet}

		<div role="group" aria-label="Direction">
			<p class="heading">Direction</p>
			{#each LAYOUT_DIRECTIONS as direction (direction)}
				{@const checked = direction === layout.direction}
				<button
					role="menuitemradio"
					type="button"
					aria-checked={checked}
					onclick={() => {
						if (!checked) onchange(layoutChoice(direction, side));
					}}
					><span class="radio"></span><Icon name={layoutDirectionIcons[direction]} /><span
						>{layoutDirectionLabels[direction]}</span
					></button
				>
			{/each}
		</div>
		<div role="separator"></div>
		<div role="group" aria-label="Alignement">
			<p class="heading">Alignement</p>
			{#each LAYOUT_SIDES as option (option)}
				{@const checked = option === side}
				<button
					role="menuitemradio"
					type="button"
					aria-checked={checked}
					onclick={() => {
						if (!checked) onchange(layoutChoice(layout.direction, option));
					}}><span class="radio"></span><span>{layoutSideLabels[option]}</span></button
				>
			{/each}
		</div>
		{#if onlanes}
			<div role="separator"></div>
			<button role="menuitem" type="button" onclick={onlanes}
				><Icon name="phosphor:columns" /><span>Lanes…</span><span class="hint">{laneSummary}</span
				></button
			>
		{/if}
	</DropdownMenu>
</div>

<style>
	.layout-chip :global(.dropdown-trigger) {
		gap: 6px;
		border: 1px solid var(--ui-border);
		border-radius: 999px;
		padding: 4px 10px 4px 9px;
		background: var(--ui-surface);
		box-shadow: 0 1px 2px #29252414;
		color: var(--ui-muted);
		font-size: 12px;
		font-weight: 500;
	}
	.layout-chip :global(.dropdown-trigger:hover:not(:disabled)),
	.layout-chip :global(.dropdown-trigger[aria-expanded='true']) {
		color: var(--ui-text);
	}
	.layout-chip :global(.dropdown-trigger:disabled) {
		cursor: default;
	}
	.heading {
		margin: 4px 10px 2px;
		color: var(--ui-muted);
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}
	.radio {
		display: inline-flex;
		flex: none;
		box-sizing: border-box;
		width: 14px;
		height: 14px;
		border: 1.5px solid var(--ui-muted);
		border-radius: 50%;
		transition: border-color 80ms ease-out;
	}
	[aria-checked='true'] .radio {
		border-width: 4.5px;
		border-color: var(--ui-accent);
	}
	[aria-checked='true'] {
		font-weight: 550;
	}
	.lanes {
		color: var(--ui-muted);
	}
	.hint {
		margin-left: auto;
		color: var(--ui-muted);
		font-size: 12px;
	}
</style>
