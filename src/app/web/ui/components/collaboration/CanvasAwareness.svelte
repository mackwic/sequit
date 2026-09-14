<script lang="ts">
	import type { PresencePoint } from '../../../../../lib/infrastructure/collaboration/participant-presence';
	import { SharedElementKind as Kind } from '../../../../../lib/infrastructure/document/shared-document-command';
	import type { CanvasModel } from '../../canvas/canvas-model';
	import { renderRelationPaths } from '../../canvas/render-relations';
	import { type CanvasAwarenessFrame, documentPointer, viewportPointer } from './canvas-awareness';
	import { getCollaborationAwareness } from './collaboration-awareness.svelte';
	let { canvas, viewport }: { canvas: CanvasModel; viewport: HTMLDivElement } = $props();
	const awareness = getCollaborationAwareness();
	let frame = $state<CanvasAwarenessFrame>({ x: 0, y: 0, zoom: 1 });
	const relations = $derived(renderRelationPaths(canvas.relations));
	const endpoints = $derived([
		...canvas.nodes.map((item) => ({ ...item, kind: Kind.Node })),
		...canvas.groups.map((item) => ({ ...item, kind: Kind.Group })),
		...canvas.junctions.map((item) => ({ ...item, kind: Kind.Junction })),
	]);
	$effect(() => {
		const currentCanvas = canvas;
		let pointer: PresencePoint | undefined;
		const update = (): void => {
			const stage = viewport.querySelector<HTMLElement>('[data-graph-stage]');
			if (!stage || currentCanvas.width <= 0) return;
			const rect = stage.getBoundingClientRect();
			if (rect.width <= 0) return;
			const port = viewport.getBoundingClientRect();
			frame = {
				x: rect.left - port.left,
				y: rect.top - port.top,
				zoom: rect.width / currentCanvas.width,
			};
			if (pointer)
				awareness.client.setPresence({
					pointer: documentPointer({ x: pointer.x - port.left, y: pointer.y - port.top }, frame),
				});
		};
		const move = (event: PointerEvent): void => {
			pointer = { x: event.clientX, y: event.clientY };
			update();
		};
		const leave = (): void => {
			pointer = undefined;
			awareness.client.setPresence({ pointer: null });
		};
		const visibility = (): void => {
			if (document.hidden) leave();
		};
		update();
		const resize = new ResizeObserver(update);
		resize.observe(viewport);
		const mutations = new MutationObserver(update);
		const stage = viewport.querySelector('[data-graph-stage]');
		if (stage) mutations.observe(stage, { attributes: true });
		viewport.addEventListener('pointermove', move);
		viewport.addEventListener('pointerleave', leave);
		viewport.addEventListener('scroll', update);
		window.addEventListener('blur', leave);
		document.addEventListener('visibilitychange', visibility);
		return () => {
			resize.disconnect();
			mutations.disconnect();
			viewport.removeEventListener('pointermove', move);
			viewport.removeEventListener('pointerleave', leave);
			viewport.removeEventListener('scroll', update);
			window.removeEventListener('blur', leave);
			document.removeEventListener('visibilitychange', visibility);
		};
	});
</script>

<div class="awareness" aria-hidden="true">
	{#each awareness.participants as peer (peer.clientId)}
		{#each peer.selected as selection, index (index)}
			{@const endpoint = endpoints.find(
				(item) => item.kind === selection.kind && item.id === selection.id,
			)}
			{#if endpoint}
				{@const point = viewportPointer(endpoint.bounds, frame)}
				<div
					class="selection"
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
				{#if relation}<svg class="relation" width="100%" height="100%"
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
			<div
				class="pointer"
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
	}
	.pointer-name {
		margin-top: 18px;
		padding: 2px 6px;
		border-radius: 4px;
		color: white;
		font: 11px/1.4 system-ui;
		white-space: nowrap;
	}
</style>
