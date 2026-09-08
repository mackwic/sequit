<script lang="ts">
	import { tick, untrack } from 'svelte';

	import { EntityKind, entityRef } from '../../web/ui/canvas/canvas-entity';
	import CanvasShortcut from '../../web/ui/components/canvas/CanvasShortcut.svelte';
	import Icon from '../../web/ui/components/ui/Icon.svelte';
	import type { WorkbenchToolProps } from '../workshop-types';
	let { workbench, session, model, presentation, report, viewport }: WorkbenchToolProps = $props();
	let open = $state(false);
	let content = $state('');
	let input = $state<HTMLTextAreaElement>();
	$effect(() => {
		if (open && input) {
			const element = input;
			void tick().then(() => {
				element.focus();
			});
		}
	});
	let nature = $state(untrack(() => model.natures[0]?.id ?? ''));
	let linked = $state(false);

	let selected = $derived(
		[...session.selection.values()].find((ref) => ref.kind === EntityKind.Node)?.id,
	);
	function create(event: SubmitEvent) {
		event.preventDefault();
		try {
			const id = `node-${crypto.randomUUID()}`;
			let link: { id: string; from: string } | undefined;
			if (linked && selected !== undefined)
				link = { id: `rel-${crypto.randomUUID()}`, from: selected };
			workbench.commands.addNode({ id, natureId: nature, markdown: content }, link);
			session.selectEntity(entityRef(EntityKind.Node, id));
			content = '';
			open = false;
			report('Boîte créée.');
		} catch (error) {
			report(String(error), true);
		}
	}
	function duplicate() {
		if (selected === undefined) return;
		try {
			const sourceId = selected;
			const id = `node-${crypto.randomUUID()}`;
			workbench.commands.duplicateNodes([{ sourceId, id }]);
			session.selectEntity(entityRef(EntityKind.Node, id));
			report('Boîte dupliquée sans recopier ses relations.');
		} catch (error) {
			report(String(error), true);
		}
	}
</script>

<CanvasShortcut
	key="n"
	scopes={[viewport]}
	enabled={presentation === 'keyboard' && !session.editing}
	onactivate={() => {
		open = true;
	}}
/>
<div class="wb-tools">
	<h2>Développer une idée</h2>
	<button
		class="primary"
		type="button"
		onclick={() => {
			open = !open;
		}}
		><Icon name="phosphor:plus" /> Nouvelle boîte {#if presentation === 'keyboard'}(N){/if}</button
	><button type="button" disabled={selected === undefined} onclick={duplicate}
		><Icon name="phosphor:copy" /> Dupliquer la sélection</button
	>
	{#if open}<form onsubmit={create}>
			<label
				>Nature<select aria-label="Nature" bind:value={nature}
					>{#each model.natures as item (item.id)}<option value={item.id}>{item.label}</option
						>{/each}</select
				></label
			><label
				>Contenu<textarea
					required
					bind:this={input}
					bind:value={content}
					placeholder="Une idée, une action, un objectif…"></textarea></label
			><label
				><span
					><input type="checkbox" bind:checked={linked} disabled={selected === undefined} /> Relier depuis
					la sélection</span
				></label
			>
			<div class="wb-row">
				<button
					type="button"
					onclick={() => {
						open = false;
					}}><Icon name="phosphor:x" /> Annuler</button
				><button type="submit" disabled={!content.trim()}
					><Icon name="phosphor:plus" /> Créer</button
				>
			</div>
		</form>{/if}
	<p>
		{#if presentation === 'contextual'}Choisissez la boîte qui précède votre nouvelle idée.{:else if presentation === 'keyboard'}Placez
			le focus sur le canvas, puis N. Le même formulaire reste accessible par bouton.{:else}Une
			palette toujours au même endroit, pour enchaîner les créations.{/if}
	</p>
</div>

<style>
	form {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
</style>
