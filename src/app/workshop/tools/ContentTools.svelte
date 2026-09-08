<script lang="ts">
	import type { ContentStyle } from '$lib/core/document/logic-document';
	import { serializeSequitToml } from '$lib/infrastructure/toml/serialize-sequit-toml';

	import { EntityKind } from '../../web/ui/canvas/canvas-entity';
	import ContentInspector from '../../web/ui/components/content/ContentInspector.svelte';
	import Icon from '../../web/ui/components/ui/Icon.svelte';
	import DownloadButton from '../DownloadButton.svelte';
	import type { WorkbenchToolProps } from '../workshop-types';
	let { workbench, model, session, presentation, report }: WorkbenchToolProps = $props();
	let selected = $derived(
		[...session.selection.values()].filter((ref) => ref.kind === EntityKind.Node),
	);
	let node = $derived(model.nodes.find((item) => item.id === selected[0]?.id));
	let nature = $derived(model.natures.find((item) => item.id === node?.natureId));
	function update(style: ContentStyle, wholeNature: boolean) {
		if (!node || !nature) return;
		const nodeId = node.id;
		const natureId = nature.id;
		try {
			if (wholeNature) workbench.commands.styleNature(natureId, style);
			else workbench.commands.styleNode(nodeId, style);
			report('Présentation enregistrée dans le document. Annuler permet de revenir en arrière.');
		} catch (error) {
			report(String(error), true);
		}
	}
</script>

{#if node && nature && selected.length === 1}
	{#key node.id}<ContentInspector
			{node}
			{nature}
			affected={model.nodes.filter((item) => item.natureId === nature.id).length}
			initialScope={presentation}
			onnodechange={(style: ContentStyle) => {
				update(style, false);
			}}
			onnaturechange={(style: ContentStyle) => {
				update(style, true);
			}}
		/>{/key}
{:else}
	<div class="wb-tools">
		<h2><Icon name="phosphor:paint-brush" /> Présentation du content</h2>
		<p>Sélectionne une seule boîte pour personnaliser sa présentation ou celle de sa nature.</p>
	</div>
{/if}

<div class="export">
	<DownloadButton
		content={serializeSequitToml(model)}
		filename="content.sequit.toml"
		label="Exporter le document"
	/>
</div>

<style>
	.export {
		margin-top: 12px;
	}
</style>
