<script lang="ts">
	import { onDestroy, type Snippet } from 'svelte';

	import type { LogicDocument } from '../../../../../lib/core/document/logic-document';
	import { isNodeClipboardText } from '../../../document/node-clipboard';
	import { EntityKind, type EntityRef } from '../../canvas/canvas-entity';
	import { isEditableTarget } from '../../canvas/canvas-event-guard';
	import {
		CANVAS_SHORTCUTS,
		CanvasShortcutId,
		matchesShortcut,
	} from '../../canvas/canvas-shortcuts';
	import {
		CONNECTION_BAND,
		type DropCandidate,
		DropKind,
		type DropPlan,
		insideConnectionBand,
		planDrop,
	} from '../../canvas/drag-drop';
	import type { NodeCreationRequest } from '../../canvas/relative-node-creation';
	import { selectionInsideEnvelope } from '../../canvas/selection-envelope';
	import type { CanvasSession } from '../../session/canvas-session.svelte';
	import { connectionChecker, dropLabel } from './drop-feedback';

	let {
		session,
		enabled,
		read,
		oncreate,
		onconnect,
		onmove,
		ondelete,
		onCopyNodes,
		onPasteNodes,
		children,
	}: {
		session: CanvasSession;
		enabled: boolean;
		/** The document the dragged element would change: it names targets and refuses relations. */
		read: () => LogicDocument;
		/** Starts typing a box: a root on the double-clicked background, or with N beside the selection. */
		oncreate: (request: NodeCreationRequest) => void;
		onconnect: (from: string, to: string) => void;
		/** The dragged elements enter the group, or return to the root when it is `undefined`. */
		onmove: (ids: readonly string[], groupId: string | undefined) => void;
		ondelete: () => void;
		onCopyNodes?: (() => string | undefined) | undefined;
		onPasteNodes?: ((text: string) => void) | undefined;
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
		/** What releasing at the pointer does, or why it does nothing. */
		feedback?: { readonly label: string; readonly refused: boolean } | undefined;
	}>();
	/** Relation checks of the current drag; a new drag reads the document afresh. */
	let refuseConnection = connectionChecker(() => read());
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
	/** Present while a connection or move drag is under way; groups then reveal their band. */
	let dragActive = $derived.by((): '' | undefined => {
		if (drag?.active === true) return '';
		return undefined;
	});
	/** Present while releasing at the pointer would do nothing: the label then says why. */
	let dropRefused = $derived.by((): '' | undefined => {
		if (drag?.feedback?.refused === true) return '';
		return undefined;
	});
	let suppressClick = false;
	onDestroy(clear);

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
	function containerOf(id: string): string | undefined {
		const element = surface.querySelector<HTMLElement>(
			`[data-canvas-entity-key][data-endpoint-id="${CSS.escape(id)}"]`,
		);
		return (
			element?.dataset['nodeGroupId'] ??
			element?.dataset['junctionGroupId'] ??
			element?.dataset['groupParentId']
		);
	}
	/** Reads the pointer's surroundings; `planDrop` decides between connecting and moving. */
	function dropAt(
		x: number,
		y: number,
		from: string,
	): { plan: DropPlan; element: HTMLElement | undefined } | undefined {
		const element = endpointAt(x, y);
		const id = element?.dataset['endpointId'];
		let candidate: DropCandidate | undefined;
		if (element !== undefined && id !== undefined) {
			const group = element.dataset['groupId'] !== undefined;
			const band =
				group &&
				insideConnectionBand(
					element.getBoundingClientRect(),
					element.querySelector('[data-group-header]')?.getBoundingClientRect(),
					x,
					y,
				);
			candidate = { id, group, band };
		} else if (
			!document
				.elementsFromPoint(x, y)
				.some((hit) => hit.matches('[data-canvas-viewport]') && surface.contains(hit))
		)
			return undefined;
		const selected = [...session.selection.values()]
			.filter(({ kind }) => kind !== EntityKind.Relation)
			.map((ref) => ref.id);
		const plan = planDrop({ from, selected, containerOf, refuseConnection }, candidate);
		if (plan === undefined) return undefined;
		return { plan, element };
	}
	function clear() {
		if (marquee?.active === true) applySelection(marquee.initial);
		target?.removeAttribute('data-connection-target');
		target?.removeAttribute('data-move-target');
		target?.removeAttribute('data-refused-target');
		target = undefined;
		drag = undefined;
		refuseConnection = connectionChecker(() => read());
		marquee = undefined;
	}
	function applySelection(refs: readonly EntityRef[]) {
		session.clearSelection();
		for (const ref of refs) session.addEntity(ref);
	}
	function updateMarqueeSelection(toX: number, toY: number) {
		const current = marquee;
		if (current === undefined) return;
		const candidates = [...surface.querySelectorAll<HTMLElement>('[data-node-id]')].map(
			(element) => ({
				ref: { kind: EntityKind.Node, id: element.dataset['nodeId'] ?? '' },
				bounds: element.getBoundingClientRect(),
			}),
		);
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
		if (!(event.target instanceof Element) || isEditableTarget(event.target)) return;
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
		target?.removeAttribute('data-connection-target');
		target?.removeAttribute('data-move-target');
		target?.removeAttribute('data-refused-target');
		const drop = dropAt(event.clientX, event.clientY, drag.from);
		let feedback: { label: string; refused: boolean } | undefined;
		if (drop !== undefined)
			feedback = {
				label: dropLabel(read(), drop.plan),
				refused: drop.plan.kind === DropKind.Refused,
			};
		drag = { ...drag, active: true, toX: event.clientX, toY: event.clientY, feedback };
		target = drop?.element;
		if (drop?.plan.kind === DropKind.Connect)
			target?.setAttribute('data-connection-target', 'true');
		if (drop?.plan.kind === DropKind.Move) target?.setAttribute('data-move-target', 'true');
		if (drop?.plan.kind === DropKind.Refused) target?.setAttribute('data-refused-target', 'true');
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
		suppressClick = current.active;
		clear();
		if (!current.active || !enabled) return;
		const plan = dropAt(event.clientX, event.clientY, current.from)?.plan;
		if (plan === undefined) return;
		if (plan.kind === DropKind.Connect) onconnect(current.from, plan.to);
		else if (plan.kind === DropKind.Move) onmove(plan.ids, plan.groupId);
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
		session.clearSelection();
		const lane = event.target.closest('[data-lane-id]:not([data-lane-region-id])');
		oncreate({ groupId, laneId: lane?.getAttribute('data-lane-id') ?? undefined });
	}
	function keydown(event: KeyboardEvent) {
		if (event.key === 'Escape' && (drag || marquee)) {
			suppressClick = drag?.active === true || marquee?.active === true;
			clear();
			event.preventDefault();
			event.stopPropagation();
			return;
		}
		if (!enabled || session.editing || isEditableTarget(event.target)) return;
		if (
			matchesShortcut(CANVAS_SHORTCUTS[CanvasShortcutId.Delete], event) &&
			session.selectionCount > 0
		) {
			event.preventDefault();
			ondelete();
			return;
		}
		if (matchesShortcut(CANVAS_SHORTCUTS[CanvasShortcutId.Create], event)) {
			event.preventDefault();
			oncreate({ near: session.relativeNodeCreationTarget });
		}
	}
	function copy(event: ClipboardEvent): void {
		if (!enabled || session.editing || !(event.target instanceof Node)) return;
		if (!surface.contains(event.target)) return;
		if (isEditableTarget(event.target)) return;
		const value = onCopyNodes?.();
		if (value === undefined || event.clipboardData === null) return;
		event.clipboardData.setData('text/plain', value);
		event.preventDefault();
	}
	function paste(event: ClipboardEvent): void {
		if (!enabled || session.editing || !(event.target instanceof Node)) return;
		if (!surface.contains(event.target)) return;
		if (isEditableTarget(event.target)) return;
		const value = event.clipboardData?.getData('text/plain') ?? '';
		if (!isNodeClipboardText(value) || onPasteNodes === undefined) return;
		event.preventDefault();
		onPasteNodes(value);
	}
</script>

<svelte:window
	onpointermove={move}
	onpointerup={up}
	onpointercancel={clear}
	onblur={clear}
	oncopy={copy}
	onpaste={paste}
/>
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="gestures"
	data-drag-active={dragActive}
	style:--connection-band={`${CONNECTION_BAND}px`}
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
		{#if drag.feedback}
			<p
				class="drop-label"
				role="status"
				data-drop-label
				data-refused={dropRefused}
				style:left={`${drag.toX + 14}px`}
				style:top={`${drag.toY + 18}px`}
			>
				{drag.feedback.label}
			</p>
		{/if}
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
	@media print {
		.gestures {
			position: static;
		}
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
	.gestures :global([data-move-target]) {
		outline: 3px dashed var(--ui-accent);
		outline-offset: 3px;
	}
	.gestures :global([data-endpoint-id][data-refused-target]) {
		outline: 3px solid var(--ui-danger);
		outline-offset: 3px;
		cursor: not-allowed;
	}
	/* While dragging, every group shows the band that connects, in its own colour. */
	.gestures[data-drag-active] :global([data-group-id]) {
		box-shadow:
			inset 0 0 0 var(--connection-band) color-mix(in srgb, var(--group-color) 40%, transparent),
			inset 0 0 0 calc(var(--connection-band) + 1px) var(--group-color);
	}
	.gestures[data-drag-active] :global([data-group-id][data-connection-target]) {
		outline-color: var(--group-color);
		box-shadow:
			inset 0 0 0 var(--connection-band) color-mix(in srgb, var(--group-color) 65%, transparent),
			inset 0 0 0 calc(var(--connection-band) + 1px) var(--group-color);
	}
	.gestures[data-drag-active] :global([data-group-id][data-move-target]) {
		outline-color: var(--group-color);
	}
	.gestures[data-drag-active] :global([data-group-id][data-refused-target]) {
		outline-color: var(--ui-danger);
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
	/* Beside the pointer, below the ghost line's end so it never hides the target it names. */
	.drop-label {
		position: fixed;
		z-index: 51;
		max-width: 320px;
		margin: 0;
		padding: 4px 8px;
		border-radius: 6px;
		background: var(--ui-text);
		color: var(--ui-surface);
		font-size: 12px;
		font-weight: 500;
		line-height: 1.4;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		pointer-events: none;
		box-shadow: var(--ui-shadow);
	}
	.drop-label[data-refused] {
		background: var(--ui-danger);
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
