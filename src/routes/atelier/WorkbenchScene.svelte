<script lang="ts">
	import './workbench.css';

	import { untrack } from 'svelte';

	import type { CanvasModel } from '$lib/canvas/canvas-model';
	import CanvasInteractionStatus from '$lib/components/canvas/CanvasInteractionStatus.svelte';
	import CanvasViewportControls from '$lib/components/canvas/CanvasViewportControls.svelte';
	import LogicCanvas from '$lib/components/canvas/LogicCanvas.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import { CanvasSession } from '$lib/session/canvas-session.svelte';

	import { WorkshopDocument } from './runtime/workshop-document';
	import { projectWorkshop } from './runtime/workshop-projection';
	import type { WorkshopSceneProps, WorkshopViewSettings } from './workshop-types';
	import WorkshopHistory from './WorkshopHistory.svelte';
	import WorkshopViewportStart from './WorkshopViewportStart.svelte';
	let {
		source,
		initialState,
		tools: Tools,
		presentation = '',
		frame = {},
	}: WorkshopSceneProps = $props();
	const workbench = untrack(() => new WorkshopDocument(source));
	const session = untrack(() => {
		const value = new CanvasSession(workbench.opened);
		value.zoom = initialState.zoom;
		for (const ref of initialState.selection) value.addEntity(ref);
		return value;
	});
	let model = $state(workbench.read());
	const view = $state({ collapsed: [] as string[], spacing: 1 });
	let projected = $derived.by(() => {
		try {
			return { document: projectWorkshop(model, view.collapsed, view.spacing), error: '' };
		} catch (error) {
			return { document: projectWorkshop(model, [], view.spacing), error: String(error) };
		}
	});
	let viewport = $state<HTMLDivElement>();
	let canvas = $state<CanvasModel>();
	let scope = $state<HTMLDivElement>();
	let message = $state('');
	let failed = $state(false);
	function report(value: string, error = false) {
		message = value;
		failed = error;
	}
	$effect(() => {
		const stop = workbench.opened.subscribe(() => {
			model = workbench.read();
		});
		return () => {
			stop();
			workbench.destroy();
		};
	});
</script>

<div
	class="workbench"
	bind:this={scope}
	class:panel-right={frame.panel === 'right'}
	class:text-mode={frame.panel === 'split'}
	class:full-canvas={frame.panel === 'overlay'}
>
	<div class="workbench-canvas">
		<LogicCanvas
			document={projected.document}
			{session}
			hideToolbar={frame.contextualActions === 'custom'}
			oncanvas={(value: CanvasModel, element: HTMLDivElement) => {
				canvas = value;
				viewport = element;
			}}
		/>
		<WorkshopViewportStart {canvas} {viewport} /><CanvasViewportControls
			{session}
		/><CanvasInteractionStatus {session} />
	</div>
	<div class="workbench-tools">
		{#if Tools}<Tools
				{workbench}
				{view}
				setView={(changes: Partial<WorkshopViewSettings>) => {
					Object.assign(view, changes);
				}}
				{session}
				{model}
				{viewport}
				{canvas}
				{presentation}
				{report}
			/>{/if}
	</div>
	<WorkshopHistory {workbench} {scope} {session} {report} />
	{#if projected.error}<div class="workbench-status failed" role="alert">
			<Icon name="phosphor:warning-circle" />
			{projected.error}
		</div>{:else if message}<div class="workbench-status" class:failed role="status">
			{#if failed}<Icon name="phosphor:warning-circle" />{:else}<Icon
					name="phosphor:check-circle"
				/>{/if}
			{message}
		</div>{/if}
</div>
