<script lang="ts">
	import Icon from '../web/ui/components/ui/Icon.svelte';
	import type { CanvasSession } from '../web/ui/session/canvas-session.svelte';
	import type { WorkshopDocument } from './runtime/workshop-document';
	let {
		workbench,
		scope,
		session,
		report,
	}: {
		workbench: WorkshopDocument;
		scope: HTMLElement | undefined;
		session: CanvasSession;
		report: (message: string) => void;
	} = $props();
	let availability = $state({ undo: false, redo: false });
	$effect(() => {
		const update = () => {
			availability = { undo: workbench.history.canUndo(), redo: workbench.history.canRedo() };
		};
		update();
		workbench.history.on('stack-item-added', update);
		workbench.history.on('stack-item-popped', update);
		workbench.history.on('stack-cleared', update);
		return () => {
			workbench.history.off('stack-item-added', update);
			workbench.history.off('stack-item-popped', update);
			workbench.history.off('stack-cleared', update);
		};
	});
	function restore(redo: boolean) {
		if (redo) {
			workbench.history.redo();
			report('Modification rétablie.');
		} else {
			workbench.history.undo();
			report('Dernière modification annulée.');
		}
	}
	function key(event: KeyboardEvent) {
		if (
			event.defaultPrevented ||
			event.isComposing ||
			event.repeat ||
			event.altKey ||
			session.editing
		)
			return;
		if ((!event.ctrlKey && !event.metaKey) || !(event.target instanceof Element)) return;
		if (
			scope?.contains(event.target) !== true ||
			event.target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"])')
		)
			return;
		const key = event.key.toLowerCase();
		if (key !== 'z' && key !== 'y') return;
		const redo = event.shiftKey || key === 'y';
		event.preventDefault();
		if ((redo && availability.redo) || (!redo && availability.undo)) restore(redo);
	}
</script>

<svelte:window onkeydown={key} />
<div class="history" role="group" aria-label="Historique de l’essai">
	<button
		type="button"
		disabled={!availability.undo || Boolean(session.editing)}
		aria-label="Annuler la modification"
		title="Annuler la modification (Ctrl/Cmd + Z)"
		onclick={() => {
			restore(false);
		}}
		><Icon name="phosphor:arrow-counter-clockwise" /><span class="label"
			>Annuler la modification</span
		></button
	>
	<button
		type="button"
		disabled={!availability.redo || Boolean(session.editing)}
		aria-label="Rétablir"
		title="Rétablir (Ctrl/Cmd + Maj + Z)"
		onclick={() => {
			restore(true);
		}}><Icon name="phosphor:arrow-clockwise" /><span class="label">Rétablir</span></button
	>
</div>

<style>
	.history {
		position: absolute;
		left: 12px;
		bottom: 12px;
		z-index: 40;
		display: flex;
		gap: 4px;
		padding: 4px;
		border: 1px solid var(--ui-border);
		border-radius: 10px;
		background: white;
		box-shadow: 0 3px 12px #29252412;
	}
	button {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 11px;
		padding: 7px;
		border-radius: 6px;
		cursor: pointer;
	}
	button:disabled {
		opacity: 0.4;
		cursor: default;
	}
	button:focus-visible {
		outline: 2px solid var(--ui-accent);
		outline-offset: 1px;
	}
	@media (max-width: 500px) {
		.label {
			display: none;
		}
		button {
			min-width: 30px;
		}
	}
</style>
