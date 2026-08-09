<script lang="ts">
	import {
		canvasEntityInDirection,
		CanvasNavigationDirection,
		canvasNodeTabOrder,
		createCanvasEntityIndex,
		type EntityKey,
		entityKey,
		EntityKind,
		type EntityRef,
		entityRef,
		entityRefFromKey,
	} from '$lib/canvas/canvas-entity';
	import type { CanvasModel } from '$lib/canvas/canvas-model';
	import { CANVAS_STAGE_PADDING, scaledStageExtent } from '$lib/canvas/canvas-viewport';
	import { renderRelationPaths } from '$lib/canvas/render-relations';
	import type { CanvasSession } from '$lib/session/canvas-session.svelte';

	import CanvasRelation from './CanvasRelation.svelte';
	import LogicNode from './LogicNode.svelte';

	let { canvas, zoom, session }: { canvas: CanvasModel; zoom: number; session: CanvasSession } =
		$props();

	let renderedRelations = $derived(renderRelationPaths(canvas.relations));
	let extent = $derived(scaledStageExtent(canvas, zoom));
	let stage = $state<HTMLDivElement>();
	let entityIndex = $derived(createCanvasEntityIndex(canvas));
	let tabOrder = $derived(canvasNodeTabOrder(canvas, entityIndex));
	let tabEntryKey = $derived.by(() => {
		const first = tabOrder[0];
		if (first === undefined) return undefined;
		return entityKey(first.kind, first.id);
	});

	function handleClick(event: MouseEvent, ref: EntityRef) {
		event.stopPropagation();
		if (event.metaKey || event.ctrlKey) session.toggleEntity(ref);
		else session.selectEntity(ref);
	}

	function handleKeyDown(event: KeyboardEvent, ref: EntityRef) {
		if (event.code === 'Space') {
			event.preventDefault();
			event.stopPropagation();
			session.toggleEntity(ref);
		} else if (event.code === 'Enter') {
			event.preventDefault();
			event.stopPropagation();
			session.selectEntity(ref);
		}
	}

	function focusAndSelect(ref: EntityRef): void {
		if (!stage) return;
		session.selectEntity(ref);
		const nextKey = entityKey(ref.kind, ref.id);
		for (const candidate of stage.querySelectorAll<HTMLElement | SVGElement>(
			'[data-canvas-entity-key]',
		)) {
			if (candidate.getAttribute('data-canvas-entity-key') !== nextKey) continue;
			candidate.focus();
			break;
		}
	}

	function navigationDirection(code: string): CanvasNavigationDirection | undefined {
		if (code === 'ArrowUp') return CanvasNavigationDirection.Up;
		if (code === 'ArrowRight') return CanvasNavigationDirection.Right;
		if (code === 'ArrowDown') return CanvasNavigationDirection.Down;
		if (code === 'ArrowLeft') return CanvasNavigationDirection.Left;
		return undefined;
	}

	function handleKeyboardNavigation(event: KeyboardEvent) {
		if (!(event.target instanceof Element)) return;
		const currentElement = event.target.closest<HTMLElement | SVGElement>(
			'[data-canvas-entity-key]',
		);
		const currentKey = currentElement?.getAttribute('data-canvas-entity-key');
		if (currentKey === null || currentKey === undefined || !stage) return;

		if (event.code === 'Tab') {
			if (tabOrder.length === 0) return;
			const currentIndex = tabOrder.findIndex((ref) => entityKey(ref.kind, ref.id) === currentKey);
			let nextIndex = 0;
			if (event.shiftKey) nextIndex = tabOrder.length - 1;
			if (currentIndex >= 0) {
				let offset = 1;
				if (event.shiftKey) offset = -1;
				nextIndex = (currentIndex + offset + tabOrder.length) % tabOrder.length;
			}
			const nextRef = tabOrder[nextIndex];
			if (nextRef === undefined) return;
			event.preventDefault();
			event.stopPropagation();
			focusAndSelect(nextRef);
			return;
		}

		const direction = navigationDirection(event.code);
		if (direction === undefined) return;
		event.preventDefault();
		event.stopPropagation();
		const currentRef = entityRefFromKey(currentKey);
		const typedCurrentKey: EntityKey = entityKey(currentRef.kind, currentRef.id);
		const nextRef = canvasEntityInDirection(entityIndex, typedCurrentKey, direction);
		if (nextRef === undefined) return;
		focusAndSelect(nextRef);
	}
</script>

<div
	class="relative min-h-full min-w-full"
	data-canvas-sizing-wrapper
	style:width={`${extent.width}px`}
	style:height={`${extent.height}px`}
>
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="relative shrink-0"
		data-graph-stage
		data-stage-width={canvas.width}
		data-stage-height={canvas.height}
		style:width={`${canvas.width}px`}
		style:height={`${canvas.height}px`}
		style:left={`max(${CANVAS_STAGE_PADDING}px, calc((100% - ${canvas.width * zoom}px) / 2))`}
		style:top={`max(${CANVAS_STAGE_PADDING}px, calc((100% - ${canvas.height * zoom}px) / 2))`}
		style:transform={`scale(${zoom})`}
		style:transform-origin="top left"
		bind:this={stage}
		onkeydown={handleKeyboardNavigation}
	>
		{#each canvas.groups as group (group.id)}
			{@const ref = entityRef(EntityKind.Group, group.id)}
			<button
				class="canvas-group"
				class:selected={session.isSelected(ref)}
				type="button"
				tabindex="-1"
				data-group-id={group.id}
				data-endpoint-id={group.id}
				data-canvas-entity-key={entityKey(ref.kind, ref.id)}
				style:left={`${group.bounds.x}px`}
				style:top={`${group.bounds.y}px`}
				style:width={`${group.bounds.width}px`}
				style:height={`${group.bounds.height}px`}
				aria-label={`Group ${group.label}`}
				aria-pressed={session.isSelected(ref)}
				onclick={(event) => {
					handleClick(event, ref);
				}}
				onkeydown={(event) => {
					handleKeyDown(event, ref);
				}}
			>
				<span class="group-header">{group.label}</span>
			</button>
		{/each}

		<svg
			class="pointer-events-none absolute inset-0 z-10"
			width={canvas.width}
			height={canvas.height}
			viewBox={`0 0 ${canvas.width} ${canvas.height}`}
			aria-label="Canvas relations"
		>
			<defs aria-hidden="true">
				<marker
					id="logic-arrow"
					viewBox="0 0 10 10"
					refX="9"
					refY="5"
					markerWidth="9"
					markerHeight="9"
					markerUnits="userSpaceOnUse"
					orient="auto"
				>
					<path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke"></path>
				</marker>
			</defs>
			{#each renderedRelations as relation (relation.id)}
				<CanvasRelation {relation} {session} />
			{/each}
		</svg>

		{#each canvas.nodes as node (node.id)}
			<LogicNode {node} {session} tabbable={entityKey(EntityKind.Node, node.id) === tabEntryKey} />
		{/each}
		{#each canvas.junctions as junction (junction.id)}
			{@const ref = entityRef(EntityKind.Junction, junction.id)}
			<button
				class="junction"
				class:selected={session.isSelected(ref)}
				type="button"
				tabindex="-1"
				data-junction-id={junction.id}
				data-endpoint-id={junction.id}
				data-canvas-entity-key={entityKey(ref.kind, ref.id)}
				style:left={`${junction.bounds.x}px`}
				style:top={`${junction.bounds.y}px`}
				style:width={`${junction.bounds.width}px`}
				style:height={`${junction.bounds.height}px`}
				title={`Junction ${junction.operator.toUpperCase()}`}
				aria-label={`Junction ${junction.operator.toUpperCase()} ${junction.id}`}
				aria-pressed={session.isSelected(ref)}
				onclick={(event) => {
					handleClick(event, ref);
				}}
				onkeydown={(event) => {
					handleKeyDown(event, ref);
				}}
			>
				{junction.operator.toUpperCase()}
			</button>
		{/each}
	</div>
</div>

<style>
	.canvas-group {
		position: absolute;
		z-index: 0;
		box-sizing: border-box;
		border: 1px solid #a8a29e;
		border-radius: 0.75rem;
		background: rgb(231 229 228 / 0.52);
		cursor: pointer;
		padding: 0;
		text-align: left;
	}

	.canvas-group .group-header {
		display: block;
		padding: 0.65rem 0.9rem;
		border-bottom: 1px solid #d6d3d1;
		color: #44403c;
		font-size: 0.75rem;
		font-weight: 700;
	}

	.canvas-group.selected,
	.junction.selected {
		outline: 3px solid #0c0a09;
		outline-offset: 2px;
	}

	.canvas-group:focus-visible,
	.junction:focus-visible {
		outline: 3px solid #0c0a09;
		outline-offset: 4px;
	}

	.junction {
		position: absolute;
		z-index: 20;
		display: grid;
		box-sizing: border-box;
		place-items: center;
		border: 2px solid #57534e;
		border-radius: 9999px;
		background: #facc15;
		color: #292524;
		font-size: 0.55rem;
		font-weight: 800;
		padding: 0;
	}
</style>
