<script lang="ts">
	import {
		JunctionOperator,
		LAYOUT_BIASES,
		LAYOUT_DIRECTIONS,
		layoutConfiguration,
		type LogicDocument,
	} from '../../../../../lib/core/document/logic-document';
	import {
		SharedCommandKind as Op,
		type SharedDocumentCommand,
		SharedElementKind as Kind,
	} from '../../../../../lib/infrastructure/document/shared-document-command';
	import { m } from '../../../i18n/paraglide/messages';
	let {
		model,
		connected,
		dispatch,
	}: {
		model: LogicDocument;
		connected: boolean;
		dispatch: (command: SharedDocumentCommand) => void;
	} = $props();
	let from = $state('');
	let to = $state('');
	let groupName = $state('Groupe');
	let groupMembers = $state<string[]>([]);
	const endpoints = $derived([...model.nodes, ...model.groups, ...model.junctions]);
	function arrange(direction: string, bias: string): void {
		const selectedDirection = LAYOUT_DIRECTIONS.find((value: string) => value === direction);
		const selectedBias = LAYOUT_BIASES.find((value: string) => value === bias);
		if (selectedDirection === undefined || selectedBias === undefined) return;
		const layout = layoutConfiguration(selectedDirection, selectedBias);
		if (layout !== undefined) dispatch({ op: Op.UpdateLayout, layout });
	}
</script>

<fieldset disabled={!connected}>
	<legend>{m.collaboration_structure_legend()}</legend>
	<button
		type="button"
		onclick={() => {
			dispatch({
				op: Op.Create,
				target: { kind: Kind.Junction, id: crypto.randomUUID() },
				properties: { operator: JunctionOperator.Xor },
			});
		}}>{m.collaboration_structure_add_junction()}</button
	>
	<button
		type="button"
		onclick={() => {
			dispatch({
				op: Op.Create,
				target: { kind: Kind.Node, id: crypto.randomUUID() },
				properties: { natureId: model.natures[0]?.id ?? '', markdown: 'Nouvelle boîte' },
			});
		}}>{m.collaboration_structure_add_node()}</button
	>
	<label
		>{m.collaboration_structure_from()}
		<select aria-label={m.collaboration_structure_from_aria()} bind:value={from}
			><option value="">{m.collaboration_structure_choose()}</option
			>{#each endpoints as endpoint (endpoint.id)}<option value={endpoint.id}>{endpoint.id}</option
				>{/each}</select
		></label
	>
	<label
		>{m.collaboration_structure_to()}
		<select aria-label={m.collaboration_structure_to_aria()} bind:value={to}
			><option value="">{m.collaboration_structure_choose()}</option
			>{#each endpoints as endpoint (endpoint.id)}<option value={endpoint.id}>{endpoint.id}</option
				>{/each}</select
		></label
	>
	<button
		type="button"
		disabled={!from || !to}
		onclick={() => {
			dispatch({
				op: Op.Create,
				target: { kind: Kind.Relation, id: crypto.randomUUID() },
				properties: { from, to },
			});
		}}>{m.collaboration_structure_link()}</button
	>
	<label
		>{m.collaboration_structure_group_name_label()}
		<input aria-label={m.collaboration_structure_group_name_aria()} bind:value={groupName} /></label
	>
	<label
		>{m.collaboration_structure_group_members_label()}
		<select
			multiple
			aria-label={m.collaboration_structure_group_members_aria()}
			bind:value={groupMembers}
			>{#each endpoints as endpoint (endpoint.id)}<option value={endpoint.id}>{endpoint.id}</option
				>{/each}</select
		></label
	>
	<button
		type="button"
		disabled={groupMembers.length === 0}
		onclick={() => {
			dispatch({ op: Op.Group, id: crypto.randomUUID(), label: groupName, members: groupMembers });
		}}>{m.collaboration_structure_group()}</button
	>
	<label
		>{m.collaboration_structure_layout_label()}
		<select
			aria-label={m.collaboration_structure_layout_aria()}
			value={`${model.layout.direction}/${model.layout.bias}`}
			onchange={(event) => {
				const [direction = '', bias = ''] = event.currentTarget.value.split('/');
				arrange(direction, bias);
			}}
		>
			{#each LAYOUT_DIRECTIONS as direction (direction)}{#each LAYOUT_BIASES as bias (bias)}{#if layoutConfiguration(direction, bias)}<option
							value={`${direction}/${bias}`}>{direction} / {bias}</option
						>{/if}{/each}{/each}
		</select></label
	>
	<output aria-label={m.collaboration_structure_layout_output_aria()}
		>{model.layout.direction} / {model.layout.bias}</output
	>
</fieldset>

<style>
	fieldset {
		display: grid;
		gap: 7px;
		margin: 12px 0;
		padding: 10px;
		border: 1px solid #dedad3;
		border-radius: 6px;
	}
	input,
	select,
	button {
		border: 1px solid #d6d3d1;
		border-radius: 4px;
		padding: 5px;
		max-width: 100%;
	}
	label {
		display: grid;
		gap: 3px;
	}
	output {
		font-size: 11px;
		color: #78716c;
	}
</style>
