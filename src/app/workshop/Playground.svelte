<script lang="ts">
	import { untrack } from 'svelte';

	import type { LogicDocument } from '../../lib/core/document/logic-document';
	import { openDocument } from '../web/projection/open-document';
	import type { CanvasModel } from '../web/ui/canvas/canvas-model';
	import CanvasInteractionStatus from '../web/ui/components/canvas/CanvasInteractionStatus.svelte';
	import CanvasViewportControls from '../web/ui/components/canvas/CanvasViewportControls.svelte';
	import LogicCanvas from '../web/ui/components/canvas/LogicCanvas.svelte';
	import { CanvasSession } from '../web/ui/session/canvas-session.svelte';
	import type { WorkshopInitialState } from './workshop-types';
	import WorkshopViewportStart from './WorkshopViewportStart.svelte';

	let {
		source,
		initialState,
	}: {
		source: string;
		initialState: WorkshopInitialState;
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
	function readModel(): LogicDocument | undefined {
		if (!opened.ok) return undefined;
		return opened.value.read();
	}
	const session = untrack(() => {
		const current = createSession();
		current.zoom = initialState.zoom;
		for (const ref of initialState.selection) current.addEntity(ref);
		return current;
	});
	let model = $state(untrack(readModel));
	let initialCanvas = $state<CanvasModel>();
	let initialViewport = $state<HTMLDivElement>();
	function oncanvas(value: CanvasModel, element: HTMLDivElement) {
		initialCanvas = value;
		initialViewport = element;
	}
	$effect(() => {
		if (!opened.ok) return;
		return opened.value.subscribe(() => {
			model = opened.value.read();
		});
	});
	$effect(() => () => {
		if (opened.ok) opened.value.destroy();
	});
</script>

{#if opened.ok && model !== undefined}
	<div class="playground">
		<div class="canvas">
			<LogicCanvas {oncanvas} document={opened.value} natures={model.natures} {session} />
			<WorkshopViewportStart canvas={initialCanvas} viewport={initialViewport} />
			<CanvasViewportControls {session} viewportElement={initialViewport} />
			<CanvasInteractionStatus {session} />
		</div>
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
</style>
