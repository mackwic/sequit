<script lang="ts">
	import type { Placement } from '@floating-ui/dom';
	import type { Snippet } from 'svelte';
	import { onMount } from 'svelte';

	import MenuSurface from './MenuSurface.svelte';

	let {
		label,
		disabled = false,
		placement = 'bottom-start',
		triggerElement = $bindable(),
		trigger,
		children,
	}: {
		label: string;
		/** Keeps the trigger visible but inert, e.g. while a shared session is offline. */
		disabled?: boolean;
		/** Where the menu opens from its trigger. */
		placement?: Placement;
		/** The trigger button, for a caller that gives focus back to it. */
		triggerElement?: HTMLButtonElement | undefined;
		trigger: Snippet<[boolean]>;
		children: Snippet;
	} = $props();

	let open = $state(false);
	let ready = $state(false);

	onMount(() => {
		ready = true;
	});

	function close(restoreFocus: boolean): void {
		open = false;
		if (restoreFocus) triggerElement?.focus();
	}

	function triggerKeydown(event: KeyboardEvent): void {
		if (event.key !== 'ArrowDown') return;
		event.preventDefault();
		open = true;
	}
</script>

<button
	class="dropdown-trigger"
	type="button"
	aria-haspopup="menu"
	aria-expanded={open}
	disabled={!ready || disabled}
	bind:this={triggerElement}
	onclick={() => (open = !open)}
	onkeydown={triggerKeydown}
>
	{@render trigger(open)}
</button>

<MenuSurface
	{open}
	{label}
	anchor={triggerElement}
	{placement}
	owner={triggerElement}
	onclose={close}
>
	{@render children()}
</MenuSurface>

<style>
	.dropdown-trigger {
		display: inline-flex;
		min-width: 0;
		align-items: center;
		border: 0;
		border-radius: 8px;
		padding: 6px 8px;
		background: transparent;
		color: var(--ui-text);
		cursor: pointer;
		transition:
			background-color 90ms ease-out,
			transform 90ms ease-out;
	}
	.dropdown-trigger:hover,
	.dropdown-trigger[aria-expanded='true'] {
		background: var(--ui-hover);
	}
	.dropdown-trigger:active {
		transform: translateY(1px);
	}
	.dropdown-trigger:focus-visible {
		outline: 2px solid var(--ui-accent);
		outline-offset: 2px;
	}
	@media (prefers-reduced-motion: reduce) {
		.dropdown-trigger {
			transition: none;
		}
	}
</style>
