<script lang="ts">
	import { autoUpdate, computePosition, flip, offset, shift } from '@floating-ui/dom';
	import { type Snippet, tick } from 'svelte';
	let {
		anchor,
		trigger,
		fixed = false,
		menu = false,
		label,
		children,
		onclose,
		element = $bindable(),
	}: {
		anchor: HTMLElement | undefined;
		trigger?: HTMLElement | undefined;
		fixed?: boolean;
		menu?: boolean;
		label: string;
		children: Snippet;
		onclose?: (restoreFocus: boolean) => void;
		element?: HTMLDivElement | undefined;
	} = $props();
	$effect(() => {
		const bar = element;
		const reference = anchor;
		if (!bar || !reference || fixed) return;
		let active = true;
		let revision = 0;
		const stop = autoUpdate(
			reference,
			bar,
			() => {
				const request = ++revision;
				void computePosition(reference, bar, {
					strategy: 'fixed',
					placement: 'top',
					middleware: [offset(10), flip(), shift({ padding: 12 })],
				}).then(({ x, y }) => {
					if (!active || request !== revision) return;
					bar.style.left = `${x}px`;
					bar.style.top = `${y}px`;
				});
			},
			{ animationFrame: true },
		);
		return () => {
			active = false;
			stop();
		};
	});
	let role = $derived.by(() => {
		if (menu) return 'menu';
		return 'group';
	});
	function items() {
		return [...(element?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
	}
	$effect(() => {
		if (!menu || !element) return;
		const bar = element;
		void tick().then(() => {
			if (bar.isConnected) bar.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
		});
	});
	function keydown(event: KeyboardEvent) {
		if (!menu) return;
		if (event.key === 'Escape' || event.key === 'Tab') {
			onclose?.(event.key === 'Escape');
			if (event.key === 'Escape') {
				event.preventDefault();
				event.stopPropagation();
			}
			return;
		}
		const controls = items();
		let index = controls.findIndex((item) => item === document.activeElement);
		if (event.key === 'ArrowDown') index += 1;
		else if (event.key === 'ArrowUp') index -= 1;
		else if (event.key === 'Home') index = 0;
		else if (event.key === 'End') index = controls.length - 1;
		else return;
		event.preventDefault();
		controls[(index + controls.length) % controls.length]?.focus();
	}
	function outside(event: PointerEvent) {
		if (event.target instanceof Node && trigger?.contains(event.target) === true) return;
		if (menu && event.target instanceof Node && element?.contains(event.target) !== true)
			onclose?.(false);
	}
</script>

<svelte:window onpointerdown={outside} />
<div
	class="floating-actions"
	class:fixed
	bind:this={element}
	{role}
	aria-label={label}
	onkeydown={keydown}
>
	{@render children()}
</div>

<style>
	.floating-actions {
		position: fixed;
		z-index: 40;
		pointer-events: auto;
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 6px;
		border: 1px solid var(--ui-border);
		border-radius: 12px;
		background: white;
		box-shadow: 0 10px 30px #0002;
	}
	.floating-actions.fixed {
		position: absolute;
		top: 12px;
		right: 12px;
	}
	.floating-actions[role='menu'] {
		flex-direction: column;
		align-items: stretch;
		min-width: 150px;
	}
</style>
