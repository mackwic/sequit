<script lang="ts">
	import { EntityKind } from '$lib/canvas/canvas-entity';
	import Icon from '$lib/components/ui/Icon.svelte';

	import type { WorkbenchToolProps } from '../workshop-types';
	let { workbench, session, model, presentation, report }: WorkbenchToolProps = $props();
	let confirmation = $state<HTMLDialogElement>();
	let selected = $derived(
		new Set(
			[...session.selection.values()]
				.filter((ref) => ref.kind === EntityKind.Node)
				.map((ref) => ref.id),
		),
	);
	let impacted = $derived(
		model.relations.filter((item) => selected.has(item.from) || selected.has(item.to)),
	);
	function remove() {
		try {
			const count = selected.size;
			const edges = impacted.length;
			workbench.commands.removeNodes(selected);
			confirmation?.close();
			report(
				`${count} boîte(s) et ${edges} relation(s) supprimées. Annuler permet de les retrouver.`,
			);
		} catch (error) {
			report(String(error), true);
		}
	}
</script>

<div class="wb-tools">
	<h2>Garder le contrôle</h2>
	<p>{selected.size} boîte(s) sélectionnée(s), {impacted.length} relation(s) concernée(s).</p>
	<button
		type="button"
		disabled={selected.size === 0}
		onclick={() => {
			if (presentation === 'confirm-impact') confirmation?.showModal();
			else remove();
		}}><Icon name="phosphor:trash" /> Supprimer la sélection</button
	>

	<p>
		Historique local de cette séance. Échap abandonne une édition ; Annuler revient sur une
		modification validée.
	</p>
</div>
<dialog class="wb-dialog" bind:this={confirmation} aria-labelledby="delete-title">
	<form
		onsubmit={(event) => {
			event.preventDefault();
			remove();
		}}
	>
		<h2 id="delete-title">Supprimer {selected.size} boîte(s) ?</h2>
		<p>
			{impacted.length} relation(s) seront aussi supprimées. Le contenu pourra être récupéré avec Annuler.
		</p>
		<div class="wb-row">
			<button type="button" onclick={() => confirmation?.close()}
				><Icon name="phosphor:x" /> Conserver</button
			><button class="ui-action danger" type="submit"
				><Icon name="phosphor:trash" /> Confirmer la suppression</button
			>
		</div>
	</form>
</dialog>
