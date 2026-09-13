<script lang="ts">
	import {
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
	<legend>Structure</legend>
	<button
		type="button"
		onclick={() => {
			dispatch({
				op: Op.Create,
				target: { kind: Kind.Nature, id: crypto.randomUUID() },
				properties: { label: 'Nouvelle nature', color: '#6f70e8' },
			});
		}}>Ajouter une nature</button
	>
	<button
		type="button"
		onclick={() => {
			dispatch({
				op: Op.Create,
				target: { kind: Kind.Junction, id: crypto.randomUUID() },
				properties: { operator: 'xor' },
			});
		}}>Ajouter une jonction</button
	>
	<button
		type="button"
		onclick={() => {
			dispatch({
				op: Op.Create,
				target: { kind: Kind.Node, id: crypto.randomUUID() },
				properties: { natureId: model.natures[0]?.id ?? '', markdown: 'Nouvelle boîte' },
			});
		}}>Ajouter une boîte</button
	>
	<label
		>De <select aria-label="Origine de la relation" bind:value={from}
			><option value="">Choisir</option>{#each endpoints as endpoint (endpoint.id)}<option
					value={endpoint.id}>{endpoint.id}</option
				>{/each}</select
		></label
	>
	<label
		>Vers <select aria-label="Destination de la relation" bind:value={to}
			><option value="">Choisir</option>{#each endpoints as endpoint (endpoint.id)}<option
					value={endpoint.id}>{endpoint.id}</option
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
		}}>Relier</button
	>
	<label>Nom du groupe <input aria-label="Nom du groupe" bind:value={groupName} /></label>
	<label
		>Éléments à regrouper <select
			multiple
			aria-label="Éléments à regrouper"
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
		}}>Regrouper</button
	>
	<label
		>Disposition <select
			aria-label="Disposition"
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
	<output aria-label="Layout partagé">{model.layout.direction} / {model.layout.bias}</output>
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
