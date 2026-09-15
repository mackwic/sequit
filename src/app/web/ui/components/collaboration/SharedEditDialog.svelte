<script lang="ts">
	import { onMount, type Snippet } from 'svelte';
	let {
		label,
		description = 'Les modifications sont partagées en direct.',
		onclose,
		oncancel,
		oncommitclose,
		children,
	}: {
		label: string;
		description?: string;
		onclose: () => void;
		oncancel?: () => void;
		oncommitclose?: () => void;
		children: Snippet;
	} = $props();
	let dialog: HTMLDialogElement;
	onMount(() => {
		dialog.showModal();
		return () => {
			dialog.close();
		};
	});
	function keydown(event: KeyboardEvent): void {
		if (
			oncommitclose === undefined ||
			event.key !== 'Enter' ||
			!event.shiftKey ||
			event.ctrlKey ||
			event.metaKey ||
			event.altKey ||
			event.repeat ||
			event.isComposing ||
			event.defaultPrevented
		)
			return;
		event.preventDefault();
		event.stopPropagation();
		oncommitclose();
	}
	function cancel(event: Event): void {
		if (oncancel === undefined) return;
		event.preventDefault();
		oncancel();
	}
</script>

<dialog
	bind:this={dialog}
	aria-label={label}
	{onclose}
	oncancel={cancel}
	onkeydowncapture={keydown}
>
	<header>
		<div>
			<h2>{label}</h2>
			<p>{description}</p>
		</div>
		<button
			type="button"
			onclick={() => {
				dialog.close();
			}}>Fermer</button
		>
	</header>
	<div class="fields">{@render children()}</div>
</dialog>

<style>
	dialog {
		pointer-events: auto;
		margin: auto;
		width: min(720px, calc(100vw - 32px));
		max-height: calc(100vh - 48px);
		padding: 24px;
		border: 1px solid #ddd8d0;
		border-radius: 16px;
		background: #faf9f6;
		color: #292524;
		box-shadow: 0 24px 80px #29252433;
	}
	dialog::backdrop {
		background: #1c191755;
		backdrop-filter: blur(3px);
	}
	header {
		display: flex;
		align-items: start;
		justify-content: space-between;
		gap: 24px;
		margin-bottom: 24px;
	}
	h2 {
		margin: 0;
		font-size: 20px;
		font-weight: 650;
	}
	p {
		margin: 4px 0 0;
		font-size: 13px;
		color: #78716c;
	}
	button {
		padding: 7px 12px;
		border: 1px solid #d6d3d1;
		border-radius: 6px;
		background: white;
		cursor: pointer;
	}
	.fields {
		display: grid;
		gap: 16px;
	}
</style>
