<script lang="ts">
	import {
		LAYOUT_DIRECTIONS,
		type LayoutConfiguration,
		type LayoutLane,
	} from '../../../../../lib/core/document/logic-document';
	import { m } from '../../../i18n/paraglide/messages';
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
		if (lanes.length === 0) return m.canvas_layout_simple();
		return m.canvas_lane_count({ count: lanes.length });
	});

	function caretIcon(open: boolean): string {
		if (open) return 'phosphor:caret-up';
		return 'phosphor:caret-down';
	}
</script>

<div class="layout-chip" class:solo={onlanes === undefined} data-layout-chip>
	<DropdownMenu label={m.common_layout()} {disabled}>
		{#snippet trigger(open)}
			<Icon name={layoutDirectionIcons[layout.direction]} size={14} />
			<span>{layoutDirectionLabels[layout.direction]}</span>
			<Icon name={caretIcon(open === true)} size={12} />
		{/snippet}

		<div role="group" aria-label={m.canvas_direction()}>
			<p class="dropdown-heading">{m.canvas_direction()}</p>
			{#each LAYOUT_DIRECTIONS as direction (direction)}
				{@const checked = direction === layout.direction}
				<button
					role="menuitemradio"
					type="button"
					aria-checked={checked}
					onclick={() => {
						if (!checked) onchange(layoutChoice(direction, side));
					}}
					><span class="dropdown-radio"></span><Icon name={layoutDirectionIcons[direction]} /><span
						>{layoutDirectionLabels[direction]}</span
					></button
				>
			{/each}
		</div>
		<div role="separator"></div>
		<div role="group" aria-label={m.canvas_alignment()}>
			<p class="dropdown-heading">{m.canvas_alignment()}</p>
			{#each LAYOUT_SIDES as option (option)}
				{@const checked = option === side}
				<button
					role="menuitemradio"
					type="button"
					aria-checked={checked}
					onclick={() => {
						if (!checked) onchange(layoutChoice(layout.direction, option));
					}}><span class="dropdown-radio"></span><span>{layoutSideLabels[option]}</span></button
				>
			{/each}
		</div>
	</DropdownMenu>
	{#if onlanes}
		<button
			class="lanes"
			type="button"
			title={m.canvas_lanes_title()}
			data-lanes-button
			{disabled}
			onclick={onlanes}><Icon name="phosphor:columns" size={14} /><span>{laneSummary}</span></button
		>
	{/if}
</div>

<style>
	/* One pill, two segments: the direction menu and the lanes dialog. */
	.layout-chip {
		display: inline-flex;
		align-items: stretch;
		border: 1px solid var(--ui-border);
		border-radius: 999px;
		background: var(--ui-surface);
		box-shadow: 0 1px 2px #29252414;
		color: var(--ui-muted);
		font-size: 12px;
		font-weight: 500;
		white-space: nowrap;
	}
	.layout-chip :global(.dropdown-trigger),
	.lanes {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		border: 0;
		border-radius: 999px 0 0 999px;
		padding: 4px 10px 4px 9px;
		background: transparent;
		color: inherit;
		font: inherit;
		cursor: pointer;
		transition: background-color 90ms ease-out;
	}
	.layout-chip.solo :global(.dropdown-trigger) {
		border-radius: 999px;
	}
	.lanes {
		border-left: 1px solid var(--ui-border);
		border-radius: 0 999px 999px 0;
	}
	.layout-chip :global(.dropdown-trigger:hover:not(:disabled)),
	.layout-chip :global(.dropdown-trigger[aria-expanded='true']),
	.lanes:hover:not(:disabled) {
		background: var(--ui-hover);
		color: var(--ui-text);
	}
	.lanes:focus-visible {
		outline: 2px solid var(--ui-accent);
		outline-offset: 2px;
	}
	.layout-chip :global(.dropdown-trigger:disabled),
	.lanes:disabled {
		cursor: default;
	}
</style>
