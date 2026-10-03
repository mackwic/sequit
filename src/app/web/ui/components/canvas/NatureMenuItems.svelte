<script lang="ts">
	import type { LogicNature } from '../../../../../lib/core/document/logic-document';
	import { natureFamilyGroups } from '../../../../../lib/core/document/nature-families';
	import { m } from '../../../i18n/paraglide/messages';
	import { natureFamilyName } from '../../content/nature-families';
	import Icon from '../ui/Icon.svelte';
	import NatureSwatch from './NatureSwatch.svelte';

	let {
		natures,
		checkedId,
		onselect,
		onmanage,
	}: {
		natures: readonly LogicNature[];
		/** The nature shown as chosen. */
		checkedId: string | undefined;
		onselect: (natureId: string) => void;
		/** Opens the document's nature library, offered last; absent when it cannot open. */
		onmanage?: (() => void) | undefined;
	} = $props();
	let groups = $derived(natureFamilyGroups(natures));
</script>

<!-- Radio items of a menu, one group per family, in the library's order, then the library itself. -->
{#each groups as group (group.family?.id ?? '')}
	{@const name = natureFamilyName(group.family)}
	<div role="group" aria-label={name}>
		<p class="dropdown-heading" aria-hidden="true">{name}</p>
		{#each group.natures as candidate (candidate.id)}
			<button
				role="menuitemradio"
				type="button"
				aria-checked={candidate.id === checkedId}
				onclick={() => {
					onselect(candidate.id);
				}}
				><span class="dropdown-radio"></span><NatureSwatch
					color={candidate.color}
					icon={candidate.icon ?? 'none'}
				/><span>{candidate.label}</span></button
			>
		{/each}
	</div>
{/each}
{#if onmanage}
	{#if groups.length > 0}<div role="separator"></div>{/if}
	<button role="menuitem" type="button" onclick={onmanage}
		><Icon name="phosphor:tag" /><span>{m.editing_canvas_manage_natures()}</span></button
	>
{/if}
