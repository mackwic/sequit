<script lang="ts">
	import { onDestroy, type Snippet } from 'svelte';

	import { EntityKind, type EntityRef } from '../../canvas/canvas-entity';
	import { RelativeNodePosition } from '../../canvas/relative-node-creation';
	import { selectionInsideEnvelope } from '../../canvas/selection-envelope';
	import type { CanvasSession } from '../../session/canvas-session.svelte';

	let {
		session,
		enabled,
		oncreate,
		onconnect,
		ondelete,
		oncreaterelative,
		children,
	}: {
		session: CanvasSession;
		enabled: boolean;
		oncreate: (groupId?: string) => void;
		onconnect: (from: string, to: string) => void;
		ondelete: () => void;
		oncreaterelative: (position: RelativeNodePosition) => void;
		children: Snippet;
	} = $props();
	let surface: HTMLDivElement;
	let drag = $state<{
		id: number;
		from: string;
		x: number;
		y: number;
		toX: number;
		toY: number;
		active: boolean;
	}>();
	let marquee = $state<{
		id: number;
		x: number;
		y: number;
		toX: number;
		toY: number;
		active: boolean;
		additive: boolean;
		initial: readonly EntityRef[];
	}>();
	let target = $state<HTMLElement>();
	let suppressClick = false;
	onDestroy(clear);
	const editable = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';

	function endpoint(element: Element | null): HTMLElement | undefined {
		const result = element?.closest<HTMLElement>('[data-endpoint-id]');
		if (result && surface.contains(result)) return result;
		return undefined;
	}
	function endpointAt(x: number, y: number): HTMLElement | undefined {
		for (const element of document.elementsFromPoint(x, y)) {
			const result = endpoint(element);
			if (result !== undefined) return result;
		}
		return undefined;
	}
	/** A drop on a group that already encloses the dragged endpoint is not a connection. */
	function connectionTargetAt(x: number, y: number, from: string): HTMLElement | undefined {
		const candidate = endpointAt(x, y);
		const to = candidate?.dataset['endpointId'];
		if (to === undefined || to === from) return undefined;
		const source = surface.querySelector<HTMLElement>(
			`[data-canvas-entity-key][data-endpoint-id="${CSS.escape(from)}"]`,
		);
		const visited: string[] = [];
		let parent = source?.dataset['nodeGroupId'] ?? source?.dataset['groupParentId'];
		while (parent !== undefined && !visited.includes(parent)) {
			if (parent === to) return undefined;
			visited.push(parent);
			parent = surface.querySelector<HTMLElement>(`[data-group-id="${CSS.escape(parent)}"]`)
				?.dataset['groupParentId'];
		}
		return candidate;
	}
	function clear() {
		if (marquee?.active === true) applySelection(marquee.initial);
		target?.removeAttribute('data-connection-target');
		target = undefined;
		drag = undefined;
		marquee = undefined;
	}
	function applySelection(refs: readonly EntityRef[]) {
		session.clearSelection();
		for (const ref of refs) session.addEntity(ref);
	}
	function updateMarqueeSelection(toX: number, toY: number) {
		const current = marquee;
		if (current === undefined) return;
		const candidates = [
			...surface.querySelectorAll<HTMLElement>('[data-node-id], [data-junction-id]'),
		].map((element) => {
			const nodeId = element.dataset['nodeId'];
			let ref: EntityRef;
			if (nodeId !== undefined) ref = { kind: EntityKind.Node, id: nodeId };
			else ref = { kind: EntityKind.Junction, id: element.dataset['junctionId'] ?? '' };
			return { ref, bounds: element.getBoundingClientRect() };
		});
		applySelection(
			selectionInsideEnvelope(current.initial, candidates, {
				from: { x: current.x, y: current.y },
				to: { x: toX, y: toY },
				additive: current.additive,
			}),
		);
	}
	$effect(() => {
		if (!enabled || session.editing) clear();
	});
	function down(event: PointerEvent) {
		suppressClick = false;
		if (
			!enabled ||
			session.editing ||
			event.button !== 0 ||
			!event.isPrimary ||
			event.ctrlKey ||
			event.metaKey ||
			event.altKey
		)
			return;
		if (!(event.target instanceof Element) || event.target.closest(editable)) return;
		const groupBackground =
			event.target.closest('[data-group-id]') !== null &&
			event.target.closest('[data-group-header]') === null;
		const canvasBackground =
			event.target.closest('[data-canvas-viewport]') !== null &&
			event.target.closest(
				'[data-node-id], [data-group-id], [data-junction-id], [data-relation-id]',
			) === null;
		if (groupBackground || canvasBackground) {
			marquee = {
				id: event.pointerId,
				x: event.clientX,
				y: event.clientY,
				toX: event.clientX,
				toY: event.clientY,
				active: false,
				additive: event.shiftKey,
				initial: [...session.selection.values()],
			};
			return;
		}
		if (event.shiftKey) return;
		const origin = endpoint(event.target) ?? endpointAt(event.clientX, event.clientY);
		const from = origin?.dataset['endpointId'];
		if (!origin || from === undefined) return;
		origin.focus({ preventScroll: true });
		drag = {
			id: event.pointerId,
			from,
			x: event.clientX,
			y: event.clientY,
			toX: event.clientX,
			toY: event.clientY,
			active: false,
		};
	}
	function move(event: PointerEvent) {
		if (marquee?.id === event.pointerId) {
			if (!marquee.active && Math.hypot(event.clientX - marquee.x, event.clientY - marquee.y) < 6)
				return;
			event.preventDefault();
			marquee = {
				...marquee,
				active: true,
				toX: event.clientX,
				toY: event.clientY,
			};
			updateMarqueeSelection(event.clientX, event.clientY);
			return;
		}
		if (drag?.id !== event.pointerId) return;
		if (!drag.active && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 6) return;
		event.preventDefault();
		drag = { ...drag, active: true, toX: event.clientX, toY: event.clientY };
		target?.removeAttribute('data-connection-target');
		target = connectionTargetAt(event.clientX, event.clientY, drag.from);
		target?.setAttribute('data-connection-target', 'true');
	}
	function up(event: PointerEvent) {
		if (marquee?.id === event.pointerId) {
			const current = marquee;
			suppressClick = current.active;
			if (current.active && enabled) updateMarqueeSelection(event.clientX, event.clientY);
			marquee = undefined;
			return;
		}
		if (drag?.id !== event.pointerId) return;
		const current = drag;
		const to = connectionTargetAt(event.clientX, event.clientY, current.from)?.dataset[
			'endpointId'
		];
		suppressClick = current.active;
		clear();
		if (current.active && to !== undefined && enabled) onconnect(current.from, to);
	}
	function click(event: MouseEvent) {
		if (!suppressClick) return;
		suppressClick = false;
		event.preventDefault();
		event.stopPropagation();
	}
	function doubleClick(event: MouseEvent) {
		if (!enabled || session.editing || !(event.target instanceof Element)) return;
		if (!event.target.closest('[data-canvas-viewport]')) return;
		const groupId = event.target.getAttribute('data-group-id') ?? undefined;
		if (
			groupId === undefined &&
			event.target.closest('button, a, [data-canvas-entity-key], input, textarea, select')
		)
			return;
		event.preventDefault();
		oncreate(groupId);
	}
	function keydown(event: KeyboardEvent) {
		if (event.key === 'Escape' && (drag || marquee)) {
			suppressClick = drag?.active === true || marquee?.active === true;
			clear();
			event.preventDefault();
			event.stopPropagation();
			return;
		}
		if (
			!enabled ||
			session.editing ||
			event.defaultPrevented ||
			event.repeat ||
			event.isComposing ||
			event.ctrlKey ||
			event.metaKey ||
			event.altKey ||
			event.shiftKey
		)
			return;
		if (!(event.target instanceof Element) || event.target.closest(editable)) return;
		if ((event.key === 'Backspace' || event.key === 'Delete') && session.selectionCount > 0) {
			event.preventDefault();
			ondelete();
		}
	}
	function relativeKeydown(event: KeyboardEvent) {
		if (
			!enabled ||
			event.defaultPrevented ||
			event.repeat ||
			event.isComposing ||
			event.code !== 'Enter' ||
			(!event.ctrlKey && !event.metaKey) ||
			event.altKey ||
			!(event.target instanceof Node) ||
			!surface.contains(event.target) ||
			session.relativeNodeCreationTarget === undefined
		)
			return;
		event.preventDefault();
		event.stopPropagation();
		let position = RelativeNodePosition.Child;
		if (event.shiftKey) position = RelativeNodePosition.Sibling;
		oncreaterelative(position);
	}
</script>

<svelte:window
	onpointermove={move}
	onpointerup={up}
	onpointercancel={clear}
	onblur={clear}
	onkeydowncapture={relativeKeydown}
/>
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="gestures"
	bind:this={surface}
	ondragstart={(event) => {
		if (drag) event.preventDefault();
	}}
	onpointerdown={down}
	onclickcapture={click}
	ondblclick={doubleClick}
	onkeydown={keydown}
>
	{@render children()}
	{#if drag?.active}
		<svg class="ghost" aria-hidden="true"
			><line x1={drag.x} y1={drag.y} x2={drag.toX} y2={drag.toY} /></svg
		>
	{/if}
	{#if marquee?.active}
		<div
			class="selection-envelope"
			style:left={`${Math.min(marquee.x, marquee.toX)}px`}
			style:top={`${Math.min(marquee.y, marquee.toY)}px`}
			style:width={`${Math.abs(marquee.toX - marquee.x)}px`}
			style:height={`${Math.abs(marquee.toY - marquee.y)}px`}
			aria-hidden="true"
		></div>
	{/if}
</div>

<style>
	.gestures {
		position: absolute;
		inset: 0;
	}
	.gestures :global([data-endpoint-id]) {
		touch-action: none;
		user-select: none;
	}
	.gestures :global([data-endpoint-id]:hover),
	.gestures :global([data-connection-target]) {
		outline: 3px solid var(--ui-accent);
		outline-offset: 3px;
	}
	.gestures :global([data-connection-target]) {
		filter: brightness(0.94);
	}
	.ghost {
		position: fixed;
		inset: 0;
		width: 100vw;
		height: 100vh;
		pointer-events: none;
		z-index: 50;
	}
	.ghost line {
		stroke: var(--ui-accent);
		stroke-width: 2;
		stroke-dasharray: 6 4;
		opacity: 0.7;
	}
	.selection-envelope {
		position: fixed;
		z-index: 45;
		box-sizing: border-box;
		pointer-events: none;
		border: 1.5px solid var(--ui-accent);
		border-radius: 4px;
		background: color-mix(in srgb, var(--ui-accent) 12%, transparent);
	}
</style>
