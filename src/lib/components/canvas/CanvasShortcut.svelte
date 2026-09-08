<script lang="ts">
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
		if (!enabled || event.defaultPrevented || event.repeat || event.isComposing) return;
		if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
		if (event.key.toLowerCase() !== key.toLowerCase()) return;
		const target = event.target;
		if (!(target instanceof Element)) return;
		if (target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])'))
			return;
		if (!scopes.some((scope) => scope?.contains(target) === true)) return;
		event.preventDefault();
		onactivate();
	}
</script>

<svelte:window onkeydown={handle} />
