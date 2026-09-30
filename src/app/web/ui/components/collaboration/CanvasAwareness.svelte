<script lang="ts">
	import { untrack } from 'svelte';
	import { SvelteMap } from 'svelte/reactivity';

	import type {
		ParticipantPresence,
		PresencePoint,
	} from '../../../../../lib/infrastructure/collaboration/participant-presence';
	import { SharedElementKind as Kind } from '../../../../../lib/infrastructure/document/shared-document-command';
	import type { CanvasModel } from '../../canvas/canvas-model';
	import { renderRelationPaths } from '../../canvas/render-relations';
	import {
		type CanvasAwarenessFrame,
		documentPointer,
		edgeIndicator,
		isOutsideViewport,
		viewportPointer,
		type ViewportSize,
	} from './canvas-awareness';
	import { getCollaborationAwareness } from './collaboration-awareness.svelte';

	/** Pointer positions leave at most this often; the remote side eases between them. */
	const PUBLISH_INTERVAL_MS = 50;
	/** A pointer that has not moved for this long is shown dimmed. */
	const IDLE_AFTER_MS = 6000;
	const EDGE_MARGIN = 28;

	let { canvas, viewport }: { canvas: CanvasModel; viewport: HTMLDivElement } = $props();
	const awareness = getCollaborationAwareness();
	let frame = $state<CanvasAwarenessFrame>({ x: 0, y: 0, zoom: 1 });
	let size = $state<ViewportSize>({ width: 0, height: 0 });
	let now = $state(Date.now());
	const relations = $derived(renderRelationPaths(canvas.relations));
	const endpoints = $derived([
		...canvas.nodes.map((item) => ({ ...item, kind: Kind.Node })),
		...canvas.groups.map((item) => ({ ...item, kind: Kind.Group })),
		...canvas.junctions.map((item) => ({ ...item, kind: Kind.Junction })),
	]);
	// When each peer's pointer last moved, to dim idle cursors.
	const movedAt = new SvelteMap<number, { readonly point: PresencePoint; readonly at: number }>();
	$effect(() => {
		const at = Date.now();
		for (const peer of awareness.participants) {
			const pointer = peer.pointer;
			if (!pointer) continue;
			const known = untrack(() => movedAt.get(peer.clientId));
			if (known?.point.x === pointer.x && known.point.y === pointer.y) continue;
			movedAt.set(peer.clientId, { point: pointer, at });
		}
	});

	function idle(peer: ParticipantPresence): boolean {
		const at = movedAt.get(peer.clientId)?.at ?? now;
		return now - at > IDLE_AFTER_MS;
	}

	function selectionCentre(peer: ParticipantPresence): PresencePoint | undefined {
		for (const selection of peer.selected) {
			const endpoint = endpoints.find(
				(item) => item.kind === selection.kind && item.id === selection.id,
			);
			if (endpoint)
				return {
					x: endpoint.bounds.x + endpoint.bounds.width / 2,
					y: endpoint.bounds.y + endpoint.bounds.height / 2,
				};
		}
		return undefined;
	}

	/** Scrolls the viewport so that a viewport-space point sits at its centre. */
	function centreOn(point: PresencePoint): void {
		viewport.scrollBy({
			left: point.x - viewport.clientWidth / 2,
			top: point.y - viewport.clientHeight / 2,
			behavior: 'smooth',
		});
	}

	$effect(() => {
		const currentCanvas = canvas;
		// The last local pointer inside the viewport; republished when the view moves under it.
		let pointer: PresencePoint | undefined;
		let publishTimer: ReturnType<typeof setTimeout> | undefined;
		let publishDue = false;
		const measure = (): boolean => {
			const stage = viewport.querySelector<HTMLElement>('[data-graph-stage]');
			if (!stage || currentCanvas.width <= 0) return false;
			const rect = stage.getBoundingClientRect();
			if (rect.width <= 0) return false;
			const port = viewport.getBoundingClientRect();
			frame = {
				x: rect.left - port.left,
				y: rect.top - port.top,
				zoom: rect.width / currentCanvas.width,
			};
			size = { width: viewport.clientWidth, height: viewport.clientHeight };
			return true;
		};
		const publish = (): void => {
			publishTimer = undefined;
			if (!publishDue || !pointer) return;
			publishDue = false;
			const port = viewport.getBoundingClientRect();
			awareness.client.setPresence({
				pointer: documentPointer({ x: pointer.x - port.left, y: pointer.y - port.top }, frame),
			});
		};
		const schedule = (): void => {
			publishDue = true;
			publishTimer ??= setTimeout(publish, PUBLISH_INTERVAL_MS);
		};
		const update = (): void => {
			if (measure() && pointer) schedule();
		};
		const move = (event: PointerEvent): void => {
			pointer = { x: event.clientX, y: event.clientY };
			update();
		};
		// Leaving the viewport or the window keeps the last position for the others; only the
		// view moving under a pointer that is no longer here must not republish it.
		const leave = (): void => {
			pointer = undefined;
		};
		const stopFollowing = (): void => {
			awareness.unfollow();
		};
		measure();
		const resize = new ResizeObserver(update);
		resize.observe(viewport);
		const mutations = new MutationObserver(update);
		const stage = viewport.querySelector('[data-graph-stage]');
		if (stage) mutations.observe(stage, { attributes: true });
		viewport.addEventListener('pointermove', move);
		viewport.addEventListener('pointerleave', leave);
		viewport.addEventListener('scroll', update);
		viewport.addEventListener('wheel', stopFollowing, { passive: true });
		viewport.addEventListener('pointerdown', stopFollowing);
		viewport.addEventListener('keydown', stopFollowing);
		const clock = setInterval(() => {
			now = Date.now();
		}, 1000);
		return () => {
			clearTimeout(publishTimer);
			clearInterval(clock);
			resize.disconnect();
			mutations.disconnect();
			viewport.removeEventListener('pointermove', move);
			viewport.removeEventListener('pointerleave', leave);
			viewport.removeEventListener('scroll', update);
			viewport.removeEventListener('wheel', stopFollowing);
			viewport.removeEventListener('pointerdown', stopFollowing);
			viewport.removeEventListener('keydown', stopFollowing);
		};
	});

	// Following: recentre whenever the followed pointer (or, failing that, selection) moves.
	$effect(() => {
		const followed = awareness.participants.find(
			({ clientId }) => clientId === awareness.following,
		);
		if (!followed) return;
		const target = followed.pointer ?? selectionCentre(followed);
		if (!target) return;
		// The scroll this triggers changes `frame`; reading it untracked avoids a feedback loop.
		untrack(() => {
			centreOn(viewportPointer(target, frame));
		});
	});
</script>

<div class="awareness">
	{#each awareness.participants as peer (peer.clientId)}
		{#each peer.selected as selection, index (index)}
			{@const endpoint = endpoints.find(
				(item) => item.kind === selection.kind && item.id === selection.id,
			)}
			{#if endpoint}
				{@const point = viewportPointer(endpoint.bounds, frame)}
				<div
					class="selection"
					aria-hidden="true"
					data-remote-selection={selection.id}
					data-participant={peer.name}
					style:border-color={peer.color}
					style:left={`${point.x - 4}px`}
					style:top={`${point.y - 4}px`}
					style:width={`${endpoint.bounds.width * frame.zoom + 8}px`}
					style:height={`${endpoint.bounds.height * frame.zoom + 8}px`}
				>
					<span class="name" style:background={peer.color}>{peer.name}</span>
				</div>
			{:else if selection.kind === Kind.Relation}
				{@const relation = relations.find((item) => item.id === selection.id)}
				{#if relation}<svg class="relation" aria-hidden="true" width="100%" height="100%"
						><g transform={`translate(${frame.x} ${frame.y}) scale(${frame.zoom})`}
							><path
								data-remote-selection={selection.id}
								data-participant={peer.name}
								d={relation.path}
								stroke={peer.color}
								stroke-width="5"
								fill="none"
								opacity="0.55"
								vector-effect="non-scaling-stroke"
							/></g
						></svg
					>{/if}
			{/if}
		{/each}
		{#if peer.pointer}
			{@const point = viewportPointer(peer.pointer, frame)}
			{#if isOutsideViewport(point, size)}
				{@const chip = edgeIndicator(point, size, EDGE_MARGIN)}
				<button
					class="edge"
					type="button"
					data-remote-edge={peer.clientId}
					data-participant={peer.name}
					title={`Aller au curseur de ${peer.name}`}
					aria-label={`Aller au curseur de ${peer.name}`}
					style:transform={`translate(${chip.x}px, ${chip.y}px) translate(-50%, -50%)`}
					style:background={peer.color}
					onclick={() => {
						centreOn(point);
					}}
				>
					<span class="arrow" style:transform={`rotate(${chip.angle}deg)`}>➜</span>
					{peer.name}
				</button>
			{:else}
				<div
					class="pointer"
					aria-hidden="true"
					class:idle={idle(peer)}
					data-remote-pointer={peer.clientId}
					data-participant={peer.name}
					style:transform={`translate(${point.x}px, ${point.y}px)`}
					style:color={peer.color}
				>
					<svg width="18" height="24" viewBox="0 0 18 24"
						><path
							d="M1 1 L16 15 L9 16 L6 22 Z"
							fill="currentColor"
							stroke="white"
							stroke-width="1.5"
						/></svg
					>
					<span class="pointer-name" style:background={peer.color}>{peer.name}</span>
				</div>
			{/if}
		{/if}
	{/each}
</div>

<style>
	.awareness {
		position: absolute;
		inset: 0;
		overflow: hidden;
		pointer-events: none;
	}
	.selection {
		position: absolute;
		border: 2px solid;
		border-radius: 10px;
	}
	.name {
		position: absolute;
		top: 0;
		left: 0;
		transform: translateY(-100%);
		padding: 2px 5px;
		color: white;
		border-radius: 4px 4px 0 0;
		font: 11px/1.4 system-ui;
		white-space: nowrap;
	}
	.relation {
		position: absolute;
		inset: 0;
	}
	.pointer {
		position: absolute;
		left: 0;
		top: 0;
		display: flex;
		align-items: flex-start;
		will-change: transform;
		transition:
			transform 110ms cubic-bezier(0.22, 1, 0.36, 1),
			opacity 400ms ease;
	}
	.pointer.idle {
		opacity: 0.35;
	}
	.pointer-name {
		margin-top: 18px;
		padding: 2px 6px;
		border-radius: 4px;
		color: white;
		font: 11px/1.4 system-ui;
		white-space: nowrap;
	}
	.edge {
		position: absolute;
		left: 0;
		top: 0;
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 3px 8px 3px 6px;
		border: 2px solid white;
		border-radius: 999px;
		color: white;
		font: 600 11px/1.4 system-ui;
		white-space: nowrap;
		box-shadow: var(--ui-shadow);
		cursor: pointer;
		pointer-events: auto;
		transition: transform 110ms cubic-bezier(0.22, 1, 0.36, 1);
	}
	.edge:focus-visible {
		outline: 2px solid var(--ui-accent);
		outline-offset: 2px;
	}
	.arrow {
		display: inline-block;
		font-size: 12px;
		line-height: 1;
	}
	@media (prefers-reduced-motion: reduce) {
		.pointer,
		.edge {
			transition: none;
		}
	}
</style>
