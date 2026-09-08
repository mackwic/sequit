<script lang="ts">
	import type { CanvasModel } from '$lib/canvas/canvas-model';

	import WorkshopViewportStart from './WorkshopViewportStart.svelte';
	let initialCanvas = $state<CanvasModel>();
	let initialViewport = $state<HTMLDivElement>();
	function oncanvas(value: CanvasModel, element: HTMLDivElement) {
		initialCanvas = value;
		initialViewport = element;
	}
	import { type Component, untrack } from 'svelte';

	import CanvasInteractionStatus from '$lib/components/canvas/CanvasInteractionStatus.svelte';
	import CanvasViewportControls from '$lib/components/canvas/CanvasViewportControls.svelte';
	import LogicCanvas from '$lib/components/canvas/LogicCanvas.svelte';
	import { openDocument } from '$lib/document/open-document';
	import type { EditingCanvasActivity } from '$lib/session/canvas-session.svelte';
	import { CanvasSession } from '$lib/session/canvas-session.svelte';

	import type { EditorPlacement, WorkshopInitialState } from './workshop-types';
	let {
		source,
		initialState,
		editor: Editor,
		placement = 'overlay',
	}: {
		source: string;
		initialState: WorkshopInitialState;
		editor?: Component<{
			editing: EditingCanvasActivity;
			session: CanvasSession;
			viewport: HTMLDivElement | undefined;
		}>;
		placement?: EditorPlacement;
	} = $props();
	const opened = untrack(() => openDocument(source));
	function createSession() {
		if (opened.ok) return new CanvasSession(opened.value);
		return new CanvasSession();
	}
	function diagnostics() {
		if (!opened.ok) return opened.diagnostics.map(({ message }) => message).join('; ');
		return '';
	}
	const session = untrack(() => {
		const current = createSession();
		current.zoom = initialState.zoom;
		for (const ref of initialState.selection) current.addEntity(ref);
		return current;
	});
	$effect(() => () => {
		if (opened.ok) opened.value.destroy();
	});
</script>

{#if opened.ok}
	<div class="playground" class:with-panel={placement === 'panel' && session.editing !== undefined}>
		<div class="canvas">
			{#if !Editor}
				<LogicCanvas {oncanvas} document={opened.value} {session} />
			{:else}
				<LogicCanvas {oncanvas} document={opened.value} {session}>
					{#snippet editor(editing, viewport)}
						{#if placement === 'overlay' && Editor}<Editor {editing} {session} {viewport} />{/if}
					{/snippet}
				</LogicCanvas>
			{/if}
			<WorkshopViewportStart
				canvas={initialCanvas}
				viewport={initialViewport}
			/><CanvasViewportControls {session} />
			<CanvasInteractionStatus {session} />
		</div>
		{#if placement === 'panel' && session.editing && Editor}
			<Editor editing={session.editing} {session} viewport={undefined} />
		{/if}
	</div>
{:else}
	<p role="alert">{diagnostics()}</p>
{/if}

<style>
	.playground {
		position: relative;
		height: 100%;
		min-height: 300px;
	}
	.canvas {
		position: absolute;
		inset: 0;
	}
	.with-panel .canvas {
		right: 360px;
	}
	@media (max-width: 800px) {
		.with-panel .canvas {
			right: 0;
		}
	}
</style>
