<script lang="ts">
	import {
		autoUpdate,
		computePosition,
		flip,
		offset,
		type Placement,
		shift,
	} from '@floating-ui/dom';
	import type { Snippet } from 'svelte';
	import { onMount, tick } from 'svelte';
	import { cubicOut } from 'svelte/easing';
	import type { TransitionConfig } from 'svelte/transition';

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

	/** Plain and radio items share navigation and close the menu once activated. */
	const ITEM = '[role="menuitem"], [role="menuitemradio"]';
	const ENABLED_ITEM = '[role="menuitem"]:not(:disabled), [role="menuitemradio"]:not(:disabled)';
	let open = $state(false);
	let ready = $state(false);
	let menuElement = $state<HTMLDivElement>();

	onMount(() => {
		ready = true;
	});

	function close(restoreFocus: boolean): void {
		open = false;
		if (restoreFocus) triggerElement?.focus();
	}

	function enabledItems(): HTMLButtonElement[] {
		return [...(menuElement?.querySelectorAll<HTMLButtonElement>(ENABLED_ITEM) ?? [])];
	}

	function focusAt(index: number): void {
		const items = enabledItems();
		items[(index + items.length) % items.length]?.focus();
	}

	function navigate(event: KeyboardEvent): void {
		const items = enabledItems();
		let index = items.findIndex((item) => item === document.activeElement);
		if (event.key === 'ArrowDown') index += 1;
		else if (event.key === 'ArrowUp') index -= 1;
		else if (event.key === 'Home') index = 0;
		else if (event.key === 'End') index = items.length - 1;
		else return;
		event.preventDefault();
		focusAt(index);
	}

	function menuKeydown(event: KeyboardEvent): void {
		if (event.key === 'Escape' || event.key === 'Tab') {
			close(event.key === 'Escape');
			if (event.key === 'Escape') event.preventDefault();
			return;
		}
		navigate(event);
	}

	function triggerKeydown(event: KeyboardEvent): void {
		if (event.key !== 'ArrowDown') return;
		event.preventDefault();
		open = true;
	}

	function outside(event: PointerEvent): void {
		if (!open || !(event.target instanceof Node)) return;
		if (triggerElement?.contains(event.target) === true) return;
		if (menuElement?.contains(event.target) === true) return;
		close(false);
	}

	function select(event: MouseEvent): void {
		if (!(event.target instanceof Element)) return;
		const item = event.target.closest<HTMLButtonElement>(ITEM);
		if (!item || item.disabled) return;
		close(false);
	}

	function motion(element: Element): TransitionConfig {
		let duration = 110;
		const view = element.ownerDocument.defaultView;
		if (view?.matchMedia('(prefers-reduced-motion: reduce)').matches === true) duration = 0;
		return {
			duration,
			easing: cubicOut,
			css: (progress) => {
				const lift = (1 - progress) * -4;
				const scale = 0.98 + progress * 0.02;
				return `opacity: ${progress}; transform: translateY(${lift}px) scale(${scale});`;
			},
		};
	}

	$effect(() => {
		if (!open || !triggerElement || !menuElement) return;
		const anchor = triggerElement;
		const surface = menuElement;
		return autoUpdate(anchor, surface, () => {
			void computePosition(anchor, surface, {
				strategy: 'fixed',
				placement,
				middleware: [offset(6), flip(), shift({ padding: 12 })],
			}).then(({ x, y }) => {
				surface.style.left = `${x}px`;
				surface.style.top = `${y}px`;
			});
		});
	});

	$effect(() => {
		if (!open || !menuElement) return;
		const menu = menuElement;
		void tick().then(() => menu.querySelector<HTMLButtonElement>(ENABLED_ITEM)?.focus());
	});
</script>

<svelte:window onpointerdown={outside} />

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

{#if open}
	<div
		class="dropdown-surface"
		role="menu"
		aria-label={label}
		tabindex="-1"
		bind:this={menuElement}
		onclick={select}
		onkeydown={menuKeydown}
		transition:motion
	>
		{@render children()}
	</div>
{/if}

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
	.dropdown-surface {
		position: fixed;
		z-index: 50;
		min-width: 260px;
		padding: 6px;
		border: 1px solid var(--ui-border);
		border-radius: 11px;
		background: var(--ui-surface);
		box-shadow: 0 14px 38px #2925241c;
		transform-origin: top left;
	}
	.dropdown-surface :global([role='menuitem']),
	.dropdown-surface :global([role='menuitemradio']) {
		display: flex;
		width: 100%;
		align-items: center;
		gap: 10px;
		min-height: 36px;
		border: 0;
		border-radius: 7px;
		padding: 8px 10px;
		background: transparent;
		color: var(--ui-text);
		font: inherit;
		font-size: 13px;
		text-align: left;
		cursor: pointer;
		transition:
			background-color 80ms ease-out,
			color 80ms ease-out,
			transform 80ms ease-out;
	}
	.dropdown-surface :global([role='menuitem']:hover:not(:disabled)),
	.dropdown-surface :global([role='menuitemradio']:hover:not(:disabled)),
	.dropdown-surface :global([role='menuitem']:focus-visible),
	.dropdown-surface :global([role='menuitemradio']:focus-visible) {
		background: var(--ui-hover);
	}
	.dropdown-surface :global([role='menuitem']:active:not(:disabled)),
	.dropdown-surface :global([role='menuitemradio']:active:not(:disabled)) {
		transform: scale(0.99);
	}
	.dropdown-surface :global([role='menuitem']:focus-visible),
	.dropdown-surface :global([role='menuitemradio']:focus-visible) {
		outline: 2px solid var(--ui-accent);
		outline-offset: -2px;
	}
	.dropdown-surface :global([role='menuitem']:disabled),
	.dropdown-surface :global([role='menuitemradio']:disabled) {
		color: var(--ui-muted);
		cursor: default;
		opacity: 0.5;
	}
	.dropdown-surface :global([role='separator']) {
		height: 1px;
		margin: 6px 8px;
		background: var(--ui-border);
	}
	.dropdown-surface :global(.dropdown-heading) {
		margin: 4px 10px 2px;
		color: var(--ui-muted);
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}
	.dropdown-surface :global(.dropdown-radio) {
		display: inline-flex;
		flex: none;
		box-sizing: border-box;
		width: 14px;
		height: 14px;
		border: 1.5px solid var(--ui-muted);
		border-radius: 50%;
		transition: border-color 80ms ease-out;
	}
	.dropdown-surface :global([aria-checked='true'] .dropdown-radio) {
		border-width: 4.5px;
		border-color: var(--ui-accent);
	}
	.dropdown-surface :global([role='menuitemradio'][aria-checked='true']) {
		font-weight: 550;
	}
	@media (prefers-reduced-motion: reduce) {
		.dropdown-trigger,
		.dropdown-surface :global([role='menuitem']),
		.dropdown-surface :global([role='menuitemradio']) {
			transition: none;
		}
	}
</style>
