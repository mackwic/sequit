<script lang="ts">
	import { EntityKind } from '../../web/ui/canvas/canvas-entity';
	import Icon from '../../web/ui/components/ui/Icon.svelte';
	import type { WorkbenchToolProps } from '../workshop-types';
	let { workbench, model, session, presentation, report, view, setView }: WorkbenchToolProps =
		$props();
	let label = $state('Une branche');
	let group = $state('');
	let selected = $derived(
		new Set(
			[...session.selection.values()]
				.filter((ref) => ref.kind === EntityKind.Node)
				.map((ref) => ref.id),
		),
	);
	function run(action: () => void) {
		try {
			action();
		} catch (error) {
			report(String(error), true);
		}
	}
	function create() {
		run(() => {
			const id = `group-${crypto.randomUUID()}`;
			workbench.commands.groupNodes({ id, label }, selected);
			group = id;
			report('Sélection regroupée.');
		});
	}
	function membership(add: boolean) {
		run(() => {
			workbench.commands.changeMembership(group, selected, add);
			report('Contenu du groupe modifié.');
		});
	}
	function dissolve() {
		run(() => {
			workbench.commands.dissolveGroup(group);
			setView({ collapsed: view.collapsed.filter((id) => id !== group) });
			group = '';
			report('Groupe dissous. Contenu conservé ; relations vers le groupe retirées.');
		});
	}
</script>

<div class="wb-tools">
	<h2>Organiser en groupes</h2>
	{#if presentation === 'inspector'}<div class="wb-list">
			{#each model.nodes as node (node.id)}<button
					type="button"
					aria-pressed={selected.has(node.id)}
					onclick={() => session.toggleEntity({ kind: EntityKind.Node, id: node.id })}
					>{node.markdown}</button
				>{/each}
		</div>{:else}<p>Ctrl/Cmd + clic sur les boîtes à regrouper.</p>{/if}<label
		>Nom du groupe<input bind:value={label} /></label
	><button type="button" disabled={selected.size === 0 || !label.trim()} onclick={create}
		><Icon name="phosphor:folder-plus" /> Grouper la sélection</button
	><label
		>Groupe actif<select
			bind:value={group}
			onchange={() => {
				label = model.groups.find((item) => item.id === group)?.label ?? '';
			}}
			><option value="">Choisir…</option>{#each model.groups as item (item.id)}<option
					value={item.id}>{item.label}</option
				>{/each}</select
		></label
	>
	<div class="wb-row">
		<button
			type="button"
			disabled={!group || !label.trim()}
			onclick={() => {
				run(() => {
					workbench.commands.renameGroup(group, label);
					report('Groupe renommé.');
				});
			}}><Icon name="phosphor:pencil-simple" /> Renommer</button
		><button
			type="button"
			disabled={!group}
			aria-pressed={view.collapsed.includes(group)}
			onclick={() => {
				if (view.collapsed.includes(group))
					setView({ collapsed: view.collapsed.filter((id) => id !== group) });
				else setView({ collapsed: [...view.collapsed, group] });
			}}><Icon name="phosphor:arrows-in" /> Replier / déplier</button
		>
	</div>
	<div class="wb-row">
		<button
			type="button"
			disabled={!group || selected.size === 0}
			onclick={() => {
				membership(true);
			}}><Icon name="phosphor:plus" /> Ajouter la sélection</button
		><button
			type="button"
			disabled={!group || selected.size === 0}
			onclick={() => {
				membership(false);
			}}><Icon name="phosphor:minus" /> Retirer la sélection</button
		>
	</div>
	<button type="button" disabled={!group} onclick={dissolve}
		><Icon name="phosphor:squares-four" /> Dissoudre le groupe</button
	>
</div>
