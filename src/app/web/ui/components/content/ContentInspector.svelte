<script lang="ts">
	import type { ContentStyle, LogicNature, LogicNode } from '$lib/core/document/logic-document';

	import { m } from '../../../i18n/paraglide/messages';
	import Icon from '../ui/Icon.svelte';
	import ContentStyleEditor from './ContentStyleEditor.svelte';
	let {
		node,
		nature,
		affected,
		initialScope = 'node',
		onnodechange,
		onnaturechange,
	}: {
		node: LogicNode;
		nature: LogicNature;
		affected: number;
		initialScope?: string;
		onnodechange: (style: ContentStyle) => void;
		onnaturechange: (style: ContentStyle) => void;
	} = $props();
	let scope = $derived(initialScope);
</script>

<section class="inspector" aria-label={m.content_inspector_title()}>
	<div class="title">
		<Icon name="phosphor:paint-brush" />
		<h2>{m.content_inspector_title()}</h2>
		<span>{m.content_inspector_theme()}</span>
	</div>
	<p class="node-title">{node.markdown || m.content_inspector_empty_node()}</p>
	<div class="scope" role="group" aria-label={m.content_inspector_scope_aria()}>
		<button
			type="button"
			aria-pressed={scope === 'node'}
			onclick={() => {
				scope = 'node';
			}}><Icon name="phosphor:square" /> {m.content_inspector_scope_node()}</button
		>
		<button
			type="button"
			aria-pressed={scope === 'nature'}
			onclick={() => {
				scope = 'nature';
			}}><Icon name="phosphor:stack" /> {m.content_inspector_scope_nature()}</button
		>
	</div>
	{#if scope === 'nature'}
		<p class="scope-note">
			{m.content_inspector_nature_scope_note({ nature: nature.label, affected })}
		</p>
		<ContentStyleEditor value={nature} onchange={onnaturechange} />
	{:else}
		<p class="scope-note">
			{m.content_inspector_node_scope_note({ nature: nature.label })}
		</p>
		<ContentStyleEditor value={node} inherited={nature} onchange={onnodechange} />
	{/if}
	<p class="hint">
		{m.content_inspector_hint()}
	</p>
</section>

<style>
	.inspector {
		padding: 15px;
		display: grid;
		gap: 16px;
		background: var(--ui-surface);
		color: var(--ui-text);
		border: 1px solid var(--ui-border);
		border-radius: 12px;
		box-shadow: var(--ui-shadow);
	}
	.title {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
	}
	h2 {
		font-size: 12px;
		font-weight: 650;
		margin: 0;
	}
	.title > span {
		color: var(--ui-muted);
		font-size: 10px;
	}
	.node-title {
		font-size: 14px;
		line-height: 1.4;
		margin: 0;
		max-height: 80px;
		overflow: auto;
		white-space: pre-wrap;
	}
	.scope {
		display: flex;
		border: 1px solid var(--ui-border);
		border-radius: 8px;
		padding: 3px;
		gap: 3px;
	}
	.scope button {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		flex: 1;
		padding: 8px 5px;
		font-size: 11px;
		border: 1px solid transparent;
		border-radius: 5px;
		background: var(--ui-surface);
		cursor: pointer;
	}
	.scope button[aria-pressed='true'] {
		background: var(--ui-accent-soft);
		border-color: var(--ui-accent);
		color: var(--ui-accent);
	}
	.scope button:focus-visible {
		outline: 2px solid var(--ui-accent);
		outline-offset: 2px;
	}
	.scope-note,
	.hint {
		margin: 0;
		color: var(--ui-muted);
		font-size: 11px;
		line-height: 1.6;
	}
	.hint {
		border-top: 1px solid var(--ui-border);
		padding-top: 12px;
	}
</style>
