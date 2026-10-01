<script lang="ts">
	import { tick } from 'svelte';

	import {
		CANVAS_SHORTCUTS,
		CanvasShortcutId,
		shortcutKeyshortcuts,
		shortcutTitle,
	} from '../../canvas/canvas-shortcuts';
	import type { CanvasSession } from '../../session/canvas-session.svelte';
	import Icon from '../ui/Icon.svelte';
	import CanvasShortcut from './CanvasShortcut.svelte';
	import ShortcutsDialog from './ShortcutsDialog.svelte';

	let {
		session,
		viewportElement,
	}: {
		session: CanvasSession;
		/** Where `?` opens the « Raccourcis clavier » panel, besides its own button. */
		viewportElement: HTMLElement | undefined;
	} = $props();
	const helpShortcut = CANVAS_SHORTCUTS[CanvasShortcutId.Help];
	let help = $state<HTMLButtonElement>();
	let helpOpen = $state(false);
	let opener: HTMLElement | undefined;
	function openHelp(from: Element | null | undefined): void {
		opener = undefined;
		if (from instanceof HTMLElement) opener = from;
		helpOpen = true;
	}
	function closeHelp(): void {
		helpOpen = false;
		// The dialog is unmounted rather than closed, so focus goes back once it is gone.
		void tick().then(() => opener?.focus());
	}
</script>

<CanvasShortcut
	shortcut={helpShortcut}
	scopes={[viewportElement, help]}
	onactivate={() => {
		openHelp(document.activeElement);
	}}
/>
<div class="absolute right-4 bottom-4 z-20 flex items-center gap-2 print:hidden">
	<div class="rounded-lg border border-[var(--ui-border)] bg-[var(--ui-surface)] p-1 shadow-sm">
		<button
			class="ui-action quiet"
			type="button"
			aria-label={helpShortcut.label}
			aria-keyshortcuts={shortcutKeyshortcuts(helpShortcut)}
			aria-haspopup="dialog"
			title={shortcutTitle(helpShortcut)}
			bind:this={help}
			onclick={() => {
				// Safari does not focus a clicked button: the button itself gets focus back.
				openHelp(help);
			}}
		>
			<Icon name="phosphor:question" />
		</button>
	</div>
	<div
		class="flex items-center gap-1 rounded-lg border border-[var(--ui-border)] bg-[var(--ui-surface)] p-1 shadow-sm"
		role="group"
		aria-label="Zoom du canvas"
	>
		<button
			class="ui-action quiet"
			type="button"
			aria-label="Zoom arrière"
			disabled={!session.canZoomOut}
			onclick={() => session.zoomOut()}
		>
			<Icon name="phosphor:minus" />
		</button>
		<button
			class="ui-action quiet min-w-12"
			type="button"
			aria-label="Réinitialiser le zoom"
			title="Revenir à 100 %"
			onclick={() => session.resetZoom()}
		>
			{session.zoomPercentage}%
		</button>
		<button
			class="ui-action quiet"
			type="button"
			aria-label="Zoom avant"
			disabled={!session.canZoomIn}
			onclick={() => session.zoomIn()}
		>
			<Icon name="phosphor:plus" />
		</button>
	</div>
</div>
{#if helpOpen}
	<ShortcutsDialog onclose={closeHelp} />
{/if}
