<script lang="ts">
	import {
		isEditableTarget,
		isPlainKeyboardEvent,
		isUnmodifiedKeyboardEvent,
	} from '../../canvas/canvas-event-guard';

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
	/** Letters must be bare; punctuation may need a layout modifier such as Alt on macOS AZERTY. */
	function claimable(event: KeyboardEvent): boolean {
		if (/^[a-z]$/i.test(key)) return isUnmodifiedKeyboardEvent(event);
		return isPlainKeyboardEvent(event);
	}
	function handle(event: KeyboardEvent) {
		if (!enabled || !claimable(event)) return;
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
