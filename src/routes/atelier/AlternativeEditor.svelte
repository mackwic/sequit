<script lang="ts">
	import { autoUpdate } from '@floating-ui/dom';
	import { tick } from 'svelte';

	import NodeMarkdownForm from '$lib/components/canvas/NodeMarkdownForm.svelte';
	import type { CanvasSession, EditingCanvasActivity } from '$lib/session/canvas-session.svelte';
	let {
		editing,
		session,
		viewport,
		inline,
	}: {
		editing: EditingCanvasActivity;
		session: CanvasSession;
		viewport: HTMLDivElement | undefined;
		inline: boolean;
	} = $props();
	let form = $state<HTMLDivElement>();
	let textarea = $state<HTMLTextAreaElement>();
	$effect(() => {
		const input = textarea;
		if (input)
			void tick().then(() => {
				input.focus();
			});
	});
	$effect(() => {
		const element = form;
		const anchor = viewport?.querySelector<HTMLElement>(
			`[data-node-id="${CSS.escape(editing.nodeId)}"]`,
		);
		if (!inline || !element || !anchor) return;
		return autoUpdate(
			anchor,
			element,
			() => {
				const bounds = anchor.getBoundingClientRect();
				element.style.left = `${Math.max(12, Math.min(bounds.left, window.innerWidth - bounds.width - 12))}px`;
				element.style.top = `${Math.max(12, Math.min(bounds.top, window.innerHeight - element.offsetHeight - 12))}px`;
				element.style.width = `${bounds.width}px`;
			},
			{ animationFrame: true },
		);
	});
</script>

<div bind:this={form} class:inline class:panel={!inline} class="editor" data-alternative-editor>
	<NodeMarkdownForm
		{editing}
		{session}
		compact
		bind:textarea
		labels={{
			content: 'Contenu Markdown',
			cancel: 'Annuler',
			close: 'Fermer',
			pending: 'Modification en attente de validation. Fermer ne retire pas cet envoi.',
			save: 'Enregistrer',
			saving: 'Enregistrement…',
		}}
	>
		{#snippet header()}<header>
				<span
					>{#if inline}Dans la boîte{:else}Panneau latéral{/if}</span
				><small>{editing.nodeId}</small>
			</header>{/snippet}
	</NodeMarkdownForm>
	<p class="hint">
		{#if editing.saving}Échap ferme le panneau. L’envoi reste en attente.{:else}Échap pour annuler ·
			Le graphe se réorganise à la validation.{/if}
	</p>
</div>

<style>
	.editor {
		pointer-events: auto;
		background: white;
		color: #292524;
		padding: 16px;
		display: flex;
		flex-direction: column;
		gap: 12px;
		box-shadow: 0 16px 48px #29252420;
	}
	.inline {
		position: fixed;
		z-index: 40;
		border: 2px solid #6f70e8;
		border-radius: 12px;
		max-height: calc(100dvh - 24px);
		overflow: auto;
	}
	.panel {
		position: absolute;
		right: 0;
		top: 0;
		bottom: 0;
		width: min(360px, 100%);
		border-left: 1px solid #ddd8d0;
	}
	header {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-weight: 600;
	}
	small,
	.hint {
		color: #78716c;
		font-size: 11px;
		font-weight: 400;
	}
</style>
