<script lang="ts">
	import { isEditableTarget, isUnmodifiedKeyboardEvent } from '../../canvas/canvas-event-guard';

	let {
		key,
		scopes,
		enabled = true,
		onactivate,
	}: {
		key: string;
		scopes: readonly (Element | undefined)[];
		enabled?: boolean;
		onactivate: () => void;
	} = $props();
	function handle(event: KeyboardEvent) {
		if (!enabled || !isUnmodifiedKeyboardEvent(event)) return;
		if (event.key.toLowerCase() !== key.toLowerCase()) return;
		const target = event.target;
		if (!(target instanceof Element)) return;
		if (isEditableTarget(target)) return;
		if (!scopes.some((scope) => scope?.contains(target) === true)) return;
		event.preventDefault();
		onactivate();
	}
</script>

<svelte:window onkeydown={handle} />
