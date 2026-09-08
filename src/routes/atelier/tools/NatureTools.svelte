<script lang="ts">
	import { untrack } from 'svelte';

	import { EntityKind } from '$lib/canvas/canvas-entity';
	import ContentStyleEditor from '$lib/components/content/ContentStyleEditor.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import { type ContentStyle, contentStyleFields } from '$lib/document/logic-document';

	import type { WorkbenchToolProps } from '../workshop-types';
	let { workbench, model, session, presentation, report }: WorkbenchToolProps = $props();
	let selected = $state(untrack(() => model.natures[0]?.id ?? ''));
	let expanded = $state(false);
	let label = $state('');
	let color = $state('#6366f1');
	let icon = $state<string>();
	let editing = $state(false);
	let replacement = $derived(model.natures.find((item) => item.id !== selected)?.id ?? '');
	function choose(id: string) {
		selected = id;
		const nature = model.natures.find((item) => item.id === id);
		label = nature?.label ?? '';
		color = nature?.color ?? '#6366f1';
		icon = nature?.icon;
		editing = true;
	}
	function save(event: SubmitEvent) {
		event.preventDefault();
		try {
			let id = selected;
			if (!id) id = `nature-${crypto.randomUUID()}`;
			workbench.commands.saveNature({ id, label, color, ...contentStyleFields(undefined, icon) });
			selected = id;
			editing = false;
			report('Nature enregistrée pour tout le document.');
		} catch (error) {
			report(String(error), true);
		}
	}
	function apply() {
		try {
			const ids = new Set(
				[...session.selection.values()]
					.filter((ref) => ref.kind === EntityKind.Node)
					.map((ref) => ref.id),
			);
			workbench.commands.assignNature(selected, ids);
			report('Nature appliquée à la sélection.');
		} catch (error) {
			report(String(error), true);
		}
	}
	function remove() {
		try {
			workbench.commands.removeNature(selected, replacement);
			selected = replacement;
			editing = false;
			report('Nature supprimée ; les boîtes ont été réaffectées.');
		} catch (error) {
			report(String(error), true);
		}
	}
</script>

<div class="wb-tools">
	<h2>Natures du document</h2>
	{#if presentation === 'popover'}<button
			type="button"
			aria-expanded={expanded}
			onclick={() => {
				expanded = !expanded;
			}}><Icon name="phosphor:stack" /> Choisir ou gérer une nature</button
		>{/if}
	{#if presentation === 'library' || expanded}
		<div class="wb-list">
			{#each model.natures as nature (nature.id)}<button
					type="button"
					aria-pressed={selected === nature.id}
					onclick={() => {
						choose(nature.id);
					}}><span style:color={nature.color}>●</span> {nature.label}</button
				>{/each}
		</div>
		<div class="wb-row">
			<button
				type="button"
				onclick={() => {
					selected = '';
					label = '';
					color = '#6366f1';
					icon = undefined;
					editing = true;
				}}><Icon name="phosphor:plus" /> Nouvelle nature</button
			><button type="button" disabled={!selected || session.selectionCount === 0} onclick={apply}
				><Icon name="phosphor:check" /> Appliquer aux boîtes</button
			>
		</div>
		{#if editing}<form onsubmit={save}>
				<label>Libellé<input required bind:value={label} /></label>
				<ContentStyleEditor
					value={contentStyleFields(color, icon)}
					onchange={(style: ContentStyle) => {
						color = style.color ?? '#6366f1';
						icon = style.icon;
					}}
				/>
				<div class="wb-row">
					<button
						type="button"
						onclick={() => {
							editing = false;
						}}><Icon name="phosphor:x" /> Annuler</button
					><button type="submit" disabled={!label.trim()}
						><Icon name="phosphor:check" /> Enregistrer la nature</button
					>
				</div>
			</form>
			{#if selected}<label
					>Réaffecter à<select bind:value={replacement}
						>{#each model.natures.filter((item) => item.id !== selected) as nature (nature.id)}<option
								value={nature.id}>{nature.label}</option
							>{/each}</select
					></label
				><button type="button" disabled={!replacement} onclick={remove}
					><Icon name="phosphor:trash" /> Supprimer la nature</button
				>
				{#if !replacement}<p>
						Crée une autre nature pour pouvoir réaffecter les boîtes avant suppression.
					</p>{/if}{/if}{/if}
	{/if}
	<p>
		Le libellé est commun à la nature. Couleur et icône sont héritées, sauf personnalisation sur une
		boîte.
	</p>
</div>

<style>
	form {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
</style>
