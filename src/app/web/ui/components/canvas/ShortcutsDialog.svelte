<script lang="ts">
	import { CANVAS_SHORTCUT_SECTIONS, sectionShortcuts } from '../../canvas/canvas-shortcuts';
	import Icon from '../ui/Icon.svelte';
	import Kbd from '../ui/Kbd.svelte';
	import ModalDialog from '../ui/ModalDialog.svelte';

	let { onclose }: { onclose: () => void } = $props();
</script>

<ModalDialog title="Raccourcis clavier" {onclose}>
	<div class="sections">
		{#each CANVAS_SHORTCUT_SECTIONS as { section, title } (section)}
			<section>
				<h3>{title}</h3>
				<dl>
					{#each sectionShortcuts(section) as shortcut (shortcut.id)}
						<div>
							<dt>{shortcut.label}</dt>
							<dd><Kbd {shortcut} announced /></dd>
						</div>
					{/each}
				</dl>
			</section>
		{/each}
	</div>
	{#snippet footer()}
		<button class="ui-action" type="button" onclick={onclose}>
			<Icon name="phosphor:x" /> Fermer
		</button>
	{/snippet}
</ModalDialog>

<style>
	.sections {
		display: grid;
		gap: 16px;
	}
	h3 {
		margin: 0 0 4px;
		color: var(--ui-muted);
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}
	dl {
		display: grid;
		margin: 0;
	}
	dl > div {
		display: flex;
		align-items: center;
		gap: 12px;
		border-bottom: 1px solid var(--ui-subtle);
		padding: 6px 0;
	}
	dl > div:last-child {
		border-bottom: 0;
	}
	dt {
		font-size: 13px;
	}
	dd {
		display: flex;
		margin: 0 0 0 auto;
	}
</style>
