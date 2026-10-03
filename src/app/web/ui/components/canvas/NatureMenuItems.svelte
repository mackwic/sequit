<script lang="ts">
	import type { LogicNature } from '../../../../../lib/core/document/logic-document';
	import { natureFamilyGroups } from '../../../../../lib/core/document/nature-families';
	import { natureFamilyName } from '../../content/nature-families';
	import NatureSwatch from './NatureSwatch.svelte';

	let {
		natures,
		checkedId,
		onselect,
	}: {
		natures: readonly LogicNature[];
		/** The nature shown as chosen. */
		checkedId: string | undefined;
		onselect: (natureId: string) => void;
	} = $props();
	let groups = $derived(natureFamilyGroups(natures));
</script>

<!-- Radio items of a menu, one group per family, in the library's order. -->
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
