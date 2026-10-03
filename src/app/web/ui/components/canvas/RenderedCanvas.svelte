<script lang="ts">
	import { GroupState } from '../../../../../lib/core/document/logic-document';
	import { m } from '../../../i18n/paraglide/messages';
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
	} from '../../canvas/canvas-entity';
	import { focusCanvasEntity } from '../../canvas/canvas-entity-dom';
	import {
		activateEntityByKeyboard,
		activateEntityByPointer,
	} from '../../canvas/canvas-entity-events';
	import type { CanvasModel, RenderedCanvasNode } from '../../canvas/canvas-model';
	import { printStageFit } from '../../canvas/canvas-print';
	import { shortcutTitle } from '../../canvas/canvas-shortcuts';
	import { CANVAS_STAGE_PADDING } from '../../canvas/canvas-viewport';
	import { foldToggleShortcut } from '../../canvas/group-edit';
	import { hostsJunction } from '../../canvas/junction-insertion';
	import { renderRelationPaths } from '../../canvas/render-relations';
	import type { CanvasSession } from '../../session/canvas-session.svelte';
	import Icon from '../ui/Icon.svelte';
	import CanvasRelation from './CanvasRelation.svelte';
	import JunctionSymbol from './JunctionSymbol.svelte';
	import LogicNode from './LogicNode.svelte';
	import type { NodeDraftControls } from './node-typing.svelte';
	import NodeDraftCard from './NodeDraftCard.svelte';
	import RelationArrow from './RelationArrow.svelte';

	const markerId = $props.id();

	let {
		canvas,
		zoom,
		session,
		draft,
		onNodeType,
		onNatureMenu,
		onStart,
		onGroupEdit,
		onGroupToggle,
		onJunctionEdit,
		onJunctionInsert,
	}: {
		canvas: CanvasModel;
		zoom: number;
		session: CanvasSession;
		/** The box typed in place, new or existing, drawn where it stands. */
		draft?: NodeDraftControls | undefined;
		/** Types a box in place on double-click or Enter; without it, they open its dialog. */
		onNodeType?: ((node: RenderedCanvasNode) => void) | undefined;
		/** Opens the nature menu of the selected box under its header; absent when read-only. */
		onNatureMenu?: ((nodeId: string, header: HTMLElement) => void) | undefined;
		/** Starts typing the first box of an empty canvas; absent when nothing can be created. */
		onStart?: (() => void) | undefined;
		onGroupEdit?: ((groupId: string) => void) | undefined;
		/** Folds or unfolds a group; absent when the document is read-only. */
		onGroupToggle?: ((groupId: string) => void) | undefined;
		onJunctionEdit?: ((junctionId: string) => void) | undefined;
		/** Inserts a junction on relations, here one double-clicked; absent for read-only views. */
		onJunctionInsert?: ((relationIds: readonly string[]) => void) | undefined;
	} = $props();
	/** The fold button names its effect, never the current state. */
	function foldGroupLabel(closed: boolean, label: string): string {
		if (closed) return m.canvas_expand_group({ label });
		return m.canvas_collapse_group({ label });
	}
	/** Aggregates stand for several source relations and host no junction. */
	function splitAction(relationId: string): ((relationId: string) => void) | undefined {
		const relation = canvas.relations.find(({ id }) => id === relationId);
		const insert = onJunctionInsert;
		if (relation === undefined || !hostsJunction(relation) || insert === undefined)
			return undefined;
		return (id) => {
			insert([id]);
		};
	}

	let relations = $derived(canvas.relations);
	let renderedRelations = $derived(renderRelationPaths(relations));
	/**
	 * The pan margin, `canvasStageMargin` in `cqw`/`cqh` of the viewport container: the layout follows
	 * a resize by itself, and the scroll position follows it in `LogicCanvas`.
	 */
	const marginX = `max(${CANVAS_STAGE_PADDING}px, 100cqw - ${CANVAS_STAGE_PADDING}px)`;
	const marginY = `max(${CANVAS_STAGE_PADDING}px, 100cqh - ${CANVAS_STAGE_PADDING}px)`;
	let printFit = $derived(printStageFit(canvas));
	let stage = $state<HTMLDivElement>();
	let entityIndex = $derived(createCanvasEntityIndex(canvas));
	let tabOrder = $derived(canvasNodeTabOrder(canvas, entityIndex));
	let focusedKey = $state<EntityKey>();
	let tabEntryKey = $derived.by(() => {
		if (focusedKey !== undefined && entityIndex.has(focusedKey)) return focusedKey;
		const first = tabOrder[0];
		if (first === undefined) return entityIndex.keys().next().value;
		return entityKey(first.kind, first.id);
	});
	function rememberFocus(event: FocusEvent): void {
		if (!(event.target instanceof Element)) return;
		const key = event.target.getAttribute('data-canvas-entity-key');
		if (key === null) return;
		const ref = entityRefFromKey(key);
		focusedKey = entityKey(ref.kind, ref.id);
	}
	function tabIndexFor(ref: EntityRef): number {
		if (entityKey(ref.kind, ref.id) === tabEntryKey) return 0;
		return -1;
	}

	function handleClick(event: MouseEvent, ref: EntityRef) {
		activateEntityByPointer(session, ref, event);
	}

	function handleKeyDown(event: KeyboardEvent, ref: EntityRef) {
		activateEntityByKeyboard(session, ref, event);
	}

	function editGroup(event: MouseEvent, ref: EntityRef): void {
		if (!(event.target instanceof Element) || event.target.closest('[data-group-header]') === null)
			return;
		event.preventDefault();
		event.stopPropagation();
		session.selectEntity(ref);
		onGroupEdit?.(ref.id);
	}

	function focusAndSelect(ref: EntityRef): void {
		if (!stage) return;
		session.selectEntity(ref);
		focusCanvasEntity(stage, entityKey(ref.kind, ref.id));
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
	function caretIcon(closed: boolean): string {
		if (closed) return 'phosphor:caret-right';
		return 'phosphor:caret-down';
	}
</script>

<div
	class="relative min-h-full min-w-full"
	data-canvas-sizing-wrapper
	style:width={`calc(${canvas.width * zoom}px + 2 * ${marginX})`}
	style:height={`calc(${canvas.height * zoom}px + 2 * ${marginY})`}
>
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="relative shrink-0"
		data-graph-stage
		data-stage-width={canvas.width}
		data-stage-height={canvas.height}
		data-print-orientation={printFit.orientation}
		style:width={`${canvas.width}px`}
		style:height={`${canvas.height}px`}
		style:left={`max(${marginX}, calc((100% - ${canvas.width * zoom}px) / 2))`}
		style:top={`max(${marginY}, calc((100% - ${canvas.height * zoom}px) / 2))`}
		style:transform={`scale(${zoom})`}
		style:transform-origin="top left"
		style:--print-scale={printFit.scale}
		bind:this={stage}
		onkeydown={handleKeyboardNavigation}
		onfocusin={rememberFocus}
	>
		{#each canvas.regions ?? [] as region (region.id)}
			<div
				class="canvas-region"
				data-region-id={region.id}
				style:left={`${region.bounds.x}px`}
				style:top={`${region.bounds.y}px`}
				style:width={`${region.bounds.width}px`}
				style:height={`${region.bounds.height}px`}
				aria-hidden="true"
			>
				<span class="canvas-region-label">{region.label}</span>
			</div>
		{/each}
		{#each canvas.lanes ?? [] as lane (JSON.stringify([lane.regionId ?? null, lane.id]))}
			<div
				class="canvas-lane"
				data-lane-id={lane.id}
				data-lane-region-id={lane.regionId}
				style:left={`${lane.bounds.x}px`}
				style:top={`${lane.bounds.y}px`}
				style:width={`${lane.bounds.width}px`}
				style:height={`${lane.bounds.height}px`}
			>
				<span class="canvas-lane-label">{lane.label}</span>
			</div>
		{/each}
		{#each canvas.groups as group (group.id)}
			{@const ref = entityRef(EntityKind.Group, group.id)}
			<button
				class="canvas-group"
				class:selected={session.isSelected(ref)}
				type="button"
				tabindex={tabIndexFor(ref)}
				data-group-id={group.id}
				data-endpoint-id={group.id}
				data-group-parent-id={group.navigation?.groupId}
				data-canvas-entity-key={entityKey(ref.kind, ref.id)}
				data-group-color={group.color}
				style:--group-color={group.color ?? '#78716c'}
				style:left={`${group.bounds.x}px`}
				style:top={`${group.bounds.y}px`}
				style:width={`${group.bounds.width}px`}
				style:height={`${group.bounds.height}px`}
				aria-label={m.canvas_group_label({ label: group.label })}
				aria-pressed={session.isSelected(ref)}
				onclick={(event) => {
					handleClick(event, ref);
				}}
				ondblclick={(event) => {
					editGroup(event, ref);
				}}
				onkeydown={(event) => {
					handleKeyDown(event, ref);
				}}
			>
				<span class="group-header" data-group-header>{group.label}</span>
			</button>
			{#if onGroupToggle}
				{@const closed = group.state === GroupState.Closed}
				<button
					class="group-fold"
					type="button"
					tabindex="-1"
					data-group-fold={group.id}
					aria-expanded={!closed}
					aria-label={foldGroupLabel(closed, group.label)}
					title={shortcutTitle(foldToggleShortcut(closed))}
					style:left={`${group.bounds.x + group.bounds.width - 30}px`}
					style:top={`${group.bounds.y + 5}px`}
					onclick={(event) => {
						event.stopPropagation();
						onGroupToggle(group.id);
					}}
					ondblclick={(event) => {
						event.stopPropagation();
					}}
					onpointerdown={(event) => {
						event.stopPropagation();
					}}
				>
					<Icon name={caretIcon(closed)} size={14} />
				</button>
			{/if}
		{/each}

		<svg
			class="pointer-events-none absolute inset-0 z-10"
			width={canvas.width}
			height={canvas.height}
			viewBox={`0 0 ${canvas.width} ${canvas.height}`}
			aria-label={m.canvas_relations()}
		>
			<RelationArrow id={markerId} />
			{#each renderedRelations as relation (relation.id)}
				<CanvasRelation
					{relation}
					{session}
					{markerId}
					tabbable={entityKey(EntityKind.Relation, relation.id) === tabEntryKey}
					ondblclick={splitAction(relation.id)}
				/>
			{/each}
		</svg>

		{#each canvas.nodes as node (node.id)}
			{#if node.id === draft?.id}
				<NodeDraftCard {node} {draft} />
			{:else}
				<LogicNode
					{node}
					{session}
					tabbable={entityKey(EntityKind.Node, node.id) === tabEntryKey}
					ontype={onNodeType}
					onnature={onNatureMenu}
				/>
			{/if}
		{/each}
		{#each canvas.junctions as junction (junction.id)}
			{@const ref = entityRef(EntityKind.Junction, junction.id)}
			<button
				class="junction"
				class:selected={session.isSelected(ref)}
				type="button"
				tabindex={tabIndexFor(ref)}
				data-junction-id={junction.id}
				data-endpoint-id={junction.id}
				data-junction-group-id={junction.groupId}
				data-canvas-entity-key={entityKey(ref.kind, ref.id)}
				style:left={`${junction.bounds.x}px`}
				style:top={`${junction.bounds.y}px`}
				style:width={`${junction.bounds.width}px`}
				style:height={`${junction.bounds.height}px`}
				title={m.canvas_junction_title({ operator: junction.operator.toUpperCase() })}
				aria-label={m.canvas_junction_label({
					operator: junction.operator.toUpperCase(),
					id: junction.id,
				})}
				aria-pressed={session.isSelected(ref)}
				onclick={(event) => {
					handleClick(event, ref);
				}}
				ondblclick={(event) => {
					if (onJunctionEdit === undefined) return;
					event.preventDefault();
					event.stopPropagation();
					session.selectEntity(ref);
					onJunctionEdit(junction.id);
				}}
				onkeydown={(event) => {
					handleKeyDown(event, ref);
				}}
			>
				<JunctionSymbol
					width={junction.bounds.width}
					height={junction.bounds.height}
					operator={junction.operator}
				/>
			</button>
		{/each}
	</div>
	{#if onStart && canvas.nodes.length === 0 && canvas.groups.length === 0 && canvas.junctions.length === 0}
		<!-- Where the first box will stand: the layout centres a lone box in the viewport. -->
		<button class="empty-prompt" type="button" data-empty-prompt onclick={onStart}>
			<span class="empty-prompt-header"><Icon name="phosphor:plus" size={15} /></span>
			<span class="empty-prompt-body">{m.canvas_empty_prompt()}</span>
		</button>
	{/if}
</div>

<style>
	.empty-prompt {
		position: absolute;
		top: 50%;
		left: 50%;
		z-index: 20;
		display: flex;
		width: 220px;
		flex-direction: column;
		box-sizing: border-box;
		border: 1.5px dashed color-mix(in srgb, var(--ui-accent) 45%, #d6d3d1);
		border-radius: 0.75rem;
		padding: 0;
		overflow: hidden;
		background: color-mix(in srgb, var(--ui-surface) 55%, transparent);
		color: var(--ui-muted);
		text-align: left;
		cursor: text;
		transform: translate(-50%, -50%);
		transition:
			border-color 120ms ease-out,
			background-color 120ms ease-out,
			color 120ms ease-out;
	}
	.empty-prompt:hover,
	.empty-prompt:focus-visible {
		border-color: var(--ui-accent);
		background: var(--ui-surface);
		color: var(--ui-text);
	}
	.empty-prompt:focus-visible {
		outline: 2px solid var(--ui-accent);
		outline-offset: 3px;
	}
	.empty-prompt-header {
		display: flex;
		align-items: center;
		border-bottom: 1px dashed color-mix(in srgb, var(--ui-accent) 30%, #d6d3d1);
		padding: 0.55rem 0.75rem;
		color: var(--ui-accent);
	}
	.empty-prompt-body {
		padding: 0.9rem 0.75rem 1rem;
		font-size: 0.875rem;
		line-height: 1.45;
	}
	@media print {
		.empty-prompt {
			display: none;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.empty-prompt {
			transition: none;
		}
	}

	.canvas-region {
		position: absolute;
		box-sizing: border-box;
		border: 1px solid color-mix(in srgb, #64748b 35%, transparent);
		border-radius: 1rem;
		background: color-mix(in srgb, #cbd5e1 8%, transparent);
		pointer-events: none;
	}

	.canvas-region-label {
		position: absolute;
		top: 4px;
		left: 12px;
		color: #475569;
		font-size: 0.75rem;
		font-weight: 600;
	}

	/* Lanes sit under every element: a double-click on their free space creates a box inside. */
	.canvas-lane {
		position: absolute;
		box-sizing: border-box;
		border: 1px dashed #cbd5e1;
		border-radius: 0.875rem;
		background: color-mix(in srgb, #e2e8f0 20%, transparent);
	}

	.canvas-lane-label {
		position: absolute;
		top: 4px;
		left: 12px;
		font-size: 0.75rem;
		font-weight: 600;
		color: #64748b;
	}

	[data-graph-stage] {
		--canvas-motion-duration: 260ms;
		--canvas-motion-easing: cubic-bezier(0.22, 1, 0.36, 1);
	}

	/* An exported picture is read from computed styles at once: no motion, no selection.
	   `data-exporting` is set by `canvas-image.ts`, outside the template: the selectors stay global. */
	:global([data-graph-stage][data-exporting]) {
		--canvas-motion-duration: 0ms;
	}

	/* Printing lays the stage at the sheet origin, unzoomed, on the sheet orientation that fits it best,
	   with its colours: browsers otherwise drop backgrounds. The inline screen geometry has to be
	   overridden; Safari ignores `size` and keeps the dialog's choice. */
	@media print {
		[data-canvas-sizing-wrapper] {
			width: auto !important;
			height: auto !important;
			min-width: 0;
			min-height: 0;
		}
		[data-graph-stage] {
			left: 0 !important;
			top: 0 !important;
			transform: none !important;
			zoom: var(--print-scale);
			print-color-adjust: exact;
		}
		[data-graph-stage][data-print-orientation='portrait'] {
			page: sheet-portrait;
		}
		[data-graph-stage][data-print-orientation='landscape'] {
			page: sheet-landscape;
		}
	}

	.canvas-group {
		position: absolute;
		display: block;
		box-sizing: border-box;
		border: 1px solid color-mix(in srgb, var(--group-color) 55%, #a8a29e);
		border-radius: 0.75rem;
		background: color-mix(in srgb, var(--group-color) 10%, transparent);
		cursor: pointer;
		padding: 0;
		text-align: left;
		outline: 3px solid transparent;
		outline-offset: 2px;
		transition-property:
			left, top, width, height, opacity, transform, border-color, background-color, outline-color;
		transition-duration: var(--canvas-motion-duration);
		transition-timing-function: var(--canvas-motion-easing);
	}

	.canvas-group .group-header {
		position: absolute;
		top: 0;
		right: 0;
		left: 0;
		z-index: 11;
		display: block;
		border-radius: 0.7rem 0.7rem 0 0;
		padding: 0.65rem 0.9rem;
		border-bottom: 1px solid color-mix(in srgb, var(--group-color) 30%, #d6d3d1);
		background: color-mix(in srgb, var(--group-color) 20%, #f5f5f4);
		color: #44403c;
		font-size: 0.75rem;
		font-weight: 700;
	}

	.group-fold {
		position: absolute;
		z-index: 12;
		display: grid;
		place-items: center;
		width: 24px;
		height: 24px;
		padding: 0;
		border: 0;
		border-radius: 0.4rem;
		background: transparent;
		color: #44403c;
		cursor: pointer;
		transition-property: left, top, background-color;
		transition-duration: var(--canvas-motion-duration);
		transition-timing-function: var(--canvas-motion-easing);
	}
	.group-fold:hover {
		background: color-mix(in srgb, var(--ui-accent) 15%, transparent);
	}

	.canvas-group.selected,
	.junction.selected {
		outline-color: var(--ui-accent);
	}

	:global([data-exporting]) .canvas-group.selected,
	:global([data-exporting]) .junction.selected {
		outline-color: transparent;
	}

	.canvas-group:focus-visible,
	.junction:focus-visible {
		outline: 2px dashed var(--ui-accent);
		outline-offset: 7px;
	}

	.junction {
		position: absolute;
		z-index: 20;
		display: grid;
		box-sizing: border-box;
		place-items: center;
		border: 0;
		border-radius: 9999px;
		background: transparent;
		color: #292524;
		font-size: 0.55rem;
		font-weight: 800;
		padding: 0;
		outline: 3px solid transparent;
		outline-offset: 2px;
		transition-property: left, top, width, height, opacity, transform, outline-color;
		transition-duration: var(--canvas-motion-duration);
		transition-timing-function: var(--canvas-motion-easing);
	}

	@starting-style {
		.canvas-group,
		.junction {
			opacity: 0;
			transform: scale(0.96);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		[data-graph-stage] {
			--canvas-motion-duration: 0s;
		}
	}
</style>
