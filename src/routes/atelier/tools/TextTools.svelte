<script lang="ts">
	import { untrack } from 'svelte';

	import Icon from '$lib/components/ui/Icon.svelte';
	import { serializeSequitToml } from '$lib/text/serialize-sequit-toml';

	import type { WorkbenchToolProps } from '../workshop-types';
	let { workbench, model, presentation, report }: WorkbenchToolProps = $props();
	let draft = $state(untrack(() => workbench.text()));
	let baseline = $state(untrack(() => draft));
	let active = $state(true);
	let dirty = $derived(draft !== baseline);
	let currentText = $derived(serializeSequitToml(model));
	let stale = $derived(currentText !== baseline);
	$effect(() => {
		if (!dirty && stale) {
			draft = currentText;
			baseline = currentText;
		}
	});
	function refresh() {
		draft = workbench.text();
		baseline = draft;
		report('Texte relu depuis le document.');
	}
	function apply() {
		if (stale) {
			report(
				'Le graphe a changé depuis l’ouverture. Relis sa version avant d’appliquer ton texte.',
				true,
			);
			return;
		}
		try {
			workbench.import(draft);
			refresh();
			report('Texte valide : graphe mis à jour.');
		} catch (error) {
			report(`Texte non appliqué : ${String(error)}`, true);
		}
	}
</script>

{#if presentation === 'dedicated'}<div class="text-switch">
		<button
			type="button"
			aria-pressed={active}
			onclick={() => {
				active = !active;
			}}
			>{#if active}Voir le graphe{:else}Ouvrir le texte{/if}</button
		>
	</div>{/if}
{#if active || presentation === 'split'}<section
		class="text-editor"
		class:dedicated={presentation === 'dedicated'}
		aria-label="Projection texte"
	>
		<div class="text-heading">
			<h2>Document · TOML</h2>
			<span
				>{#if stale}Graphe modifié · brouillon conservé{:else if dirty}Brouillon modifié{:else}Synchronisé{/if}</span
			>
		</div>
		<label class="sr-only" for="document-source">Source du document</label><textarea
			id="document-source"
			bind:value={draft}
			spellcheck="false"></textarea>
		{#if stale}<p role="status">
				Le graphe a changé. Relire remplacera le brouillon par sa version actuelle.
			</p>{/if}
		<div class="text-actions">
			<button type="button" disabled={!dirty || stale} onclick={apply}
				><Icon name="phosphor:check" /> Appliquer le texte</button
			><button type="button" disabled={!dirty && !stale} onclick={refresh}
				><Icon name="phosphor:arrow-counter-clockwise" /> Abandonner le brouillon et relire</button
			>
		</div>
	</section>{/if}

<style>
	.text-editor {
		position: relative;
		width: 100%;
		height: 100%;
		min-height: 310px;
		pointer-events: auto;
		background: white;
		border: 1px solid #d8d2ca;
		border-radius: 14px;
		padding: 16px;
		display: flex;
		flex-direction: column;
		gap: 12px;
		z-index: 35;
		box-shadow: 0 12px 40px #29252418;
	}
	.text-editor.dedicated {
		position: absolute;
		height: auto;
		inset: 64px 16px 70px;
		width: auto;
	}
	.text-heading,
	.text-actions {
		display: flex;
		justify-content: space-between;
		gap: 8px;
		flex-wrap: wrap;
	}
	.text-heading h2 {
		font-weight: 650;
	}
	.text-heading span,
	.text-editor p {
		font-size: 12px;
		color: #78716c;
	}
	.text-editor textarea {
		flex: 1;
		min-height: 200px;
		resize: none;
		border: 1px solid #d6d3d1;
		border-radius: 8px;
		padding: 12px;
		font: 12px/1.7 monospace;
		background: #faf9f6;
	}
	.text-editor button,
	.text-switch button {
		border: 1px solid #d6d3d1;
		border-radius: 8px;
		background: white;
		padding: 8px;
		font-size: 12px;
	}
	.text-editor button:disabled {
		opacity: 0.45;
	}
	.text-switch {
		pointer-events: auto;
		position: absolute;
		top: 16px;
		right: 16px;
		z-index: 40;
	}
	@media (max-width: 700px) {
		.text-editor {
			width: 100%;
			padding: 10px;
		}
	}
</style>
