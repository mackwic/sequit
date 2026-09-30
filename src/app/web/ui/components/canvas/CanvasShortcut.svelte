<script lang="ts">
	import { isEditableTarget } from '../../canvas/canvas-event-guard';
	import { type CanvasShortcut, matchesShortcut } from '../../canvas/canvas-shortcuts';

	let {
		shortcut,
		scopes,
		enabled = true,
		onactivate,
	}: {
		shortcut: CanvasShortcut;
		scopes: readonly (Element | undefined)[];
		enabled?: boolean;
		onactivate: () => void;
	} = $props();
	function handle(event: KeyboardEvent) {
		if (!enabled || !matchesShortcut(shortcut, event)) return;
		const target = event.target;
		if (!(target instanceof Element)) return;
		if (isEditableTarget(target)) return;
		if (!scopes.some((scope) => scope?.contains(target) === true)) return;
		event.preventDefault();
		onactivate();
	}
</script>

<svelte:window onkeydown={handle} />
