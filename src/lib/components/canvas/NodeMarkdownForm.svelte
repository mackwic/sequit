<script lang="ts">
	import type { Snippet } from 'svelte';

	import Icon from '$lib/components/ui/Icon.svelte';
	import {
		CanvasEditAvailability,
		type CanvasSession,
		type EditingCanvasActivity,
	} from '$lib/session/canvas-session.svelte';
	const formId = $props.id();
	let {
		editing,
		session,
		header,
		compact = false,
		textarea = $bindable(),
		labels = { content: 'Node Markdown', cancel: 'Cancel', save: 'Save', saving: 'Saving...' },
	}: {
		editing: EditingCanvasActivity;
		session: CanvasSession;
		header?: Snippet;
		compact?: boolean;
		textarea?: HTMLTextAreaElement | undefined;
		labels?: {
			content: string;
			cancel: string;
			save: string;
			saving: string;
			close?: string;
			pending?: string;
		};
	} = $props();
	let deleted = $derived(editing.availability === CanvasEditAvailability.Deleted);
	let form = $state<HTMLFormElement>();
	function keydown(event: KeyboardEvent) {
		if (!(event.target instanceof Node) || form?.contains(event.target) !== true) return;
		if (event.key !== 'Escape' || event.defaultPrevented) return;
		event.preventDefault();
		event.stopPropagation();
		session.cancel();
	}
	function submit(event: SubmitEvent) {
		event.preventDefault();
		void session.saveDraft();
	}
</script>

<svelte:window onkeydown={keydown} />

<form
	class="flex max-h-[min(44rem,calc(100vh-2rem))] min-h-[min(36rem,calc(100vh-2rem))] flex-col"
	onsubmit={submit}
	bind:this={form}
	class:compact
>
	{@render header?.()}
	<div class="flex min-h-0 flex-1 flex-col gap-3 px-6 py-5 max-sm:px-4 max-sm:py-4">
		{#if !compact}<div
				class="flex min-h-8 shrink-0 items-center rounded-lg border border-dashed border-stone-300 bg-stone-50 px-3 text-xs font-medium text-stone-500"
				aria-hidden="true"
			>
				Markdown
			</div>{/if}
		<label
			class="text-sm font-semibold text-stone-700"
			for={`node-markdown-${formId}-${editing.nodeId}`}
		>
			{labels.content}
		</label>
		<textarea
			class="min-h-64 flex-1 resize-none rounded-xl border border-stone-300 bg-white p-4 font-mono text-sm leading-relaxed text-stone-900 outline-none focus:border-stone-950 focus:ring-2 focus:ring-stone-950/20 disabled:bg-stone-50"
			id={`node-markdown-${formId}-${editing.nodeId}`}
			value={editing.draft}
			disabled={editing.saving}
			bind:this={textarea}
			oninput={(event) => session.updateDraft(event.currentTarget.value)}></textarea>
		{#if editing.saving}<p class="text-sm text-stone-600" role="status">
				{labels.pending ?? 'Change submitted. Closing the editor does not cancel the pending save.'}
			</p>{/if}
		{#if editing.diagnostic}
			<p
				class="m-0 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
				role="alert"
			>
				{editing.diagnostic}
			</p>
		{/if}
	</div>
	<footer
		class="flex shrink-0 items-center justify-end gap-3 border-t border-stone-200 bg-stone-50 px-6 py-4 max-sm:px-4"
	>
		<button
			class="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-stone-700 hover:bg-stone-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-950"
			type="button"
			onclick={() => session.cancel()}
		>
			<Icon name="phosphor:x" />
			{#if editing.saving}{labels.close ?? 'Close'}{:else}{labels.cancel}{/if}
		</button>
		<button
			class="inline-flex items-center gap-2 rounded-lg bg-[var(--ui-accent)] px-5 py-2 text-sm font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-950 disabled:cursor-not-allowed disabled:opacity-45"
			type="submit"
			disabled={deleted || editing.saving}
		>
			<Icon name="phosphor:check" />
			{#if editing.saving}{labels.saving}{:else}{labels.save}{/if}
		</button>
	</footer>
</form>

<style>
	.compact {
		min-height: 0;
		max-height: none;
		flex: 1;
		gap: 12px;
	}
	.compact > div {
		padding: 0;
	}
	.compact label {
		font-size: 12px;
	}
	.compact textarea {
		min-height: 150px;
		padding: 10px;
		border-radius: 6px;
		font-size: 13px;
		resize: vertical;
	}
	.compact footer {
		padding: 0;
		border: 0;
		background: transparent;
		justify-content: flex-start;
		flex-wrap: wrap;
		gap: 8px;
	}
	.compact button {
		padding: 8px 10px;
		font-size: 12px;
		border-radius: 6px;
	}
</style>
