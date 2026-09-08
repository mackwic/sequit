<script lang="ts">
	import { EntityKind } from '../../web/ui/canvas/canvas-entity';
	import CanvasShortcut from '../../web/ui/components/canvas/CanvasShortcut.svelte';
	import FloatingActions from '../../web/ui/components/canvas/FloatingActions.svelte';
	import Icon from '../../web/ui/components/ui/Icon.svelte';
	import type { WorkbenchToolProps } from '../workshop-types';
	let { workbench, session, viewport, canvas, presentation, report }: WorkbenchToolProps = $props();
	let bar = $state<HTMLDivElement>();
	let menu = $state(false);
	let selected = $derived(
		[...session.selection.values()].filter((ref) => ref.kind === EntityKind.Node),
	);
	let node = $derived(canvas?.nodes.find((item) => item.id === selected[0]?.id));
	let anchor = $derived(
		[...(viewport?.querySelectorAll<HTMLElement>('[data-node-id]') ?? [])].find(
			(element) => element.dataset['nodeId'] === node?.id,
		),
	);
	let actionTabIndex = $derived.by(() => {
		if (presentation === 'menu') return -1;
		return undefined;
	});
	let actionRole = $derived.by(() => {
		if (presentation === 'menu') return 'menuitem';
		return undefined;
	});
	let opener: HTMLElement | undefined;
	let trigger = $state<HTMLElement>();
	function close(restoreFocus: boolean) {
		menu = false;
		if (restoreFocus) opener?.focus();
	}
	$effect(() => {
		if (!viewport || presentation !== 'menu') return;
		const area = viewport;
		const show = (event: MouseEvent) => {
			if (!(event.target instanceof Element)) return;
			const id = event.target.closest('[data-node-id]')?.getAttribute('data-node-id');
			if (id == null || id === '') return;
			event.preventDefault();
			session.selectEntity({ kind: EntityKind.Node, id });
			opener = event.target.closest<HTMLElement>('[data-node-id]') ?? undefined;
			menu = true;
		};
		area.addEventListener('contextmenu', show);
		return () => {
			area.removeEventListener('contextmenu', show);
		};
	});
	function duplicate() {
		try {
			const copies = selected.map((ref) => ({
				sourceId: ref.id,
				id: `node-${crypto.randomUUID()}`,
			}));
			workbench.commands.duplicateNodes(copies);
			report('Sélection dupliquée en une seule action.');
		} catch (error) {
			report(String(error), true);
		}
	}
</script>

<CanvasShortcut
	key="e"
	scopes={[viewport, bar]}
	enabled={selected.length === 1 && Boolean(node) && !session.editing}
	onactivate={() => {
		if (node) session.beginNodeMarkdownEdit(node);
	}}
/>

<div class="wb-tools">
	<h2>Actions adaptées à la sélection</h2>
	<p>
		Une boîte : éditer. Plusieurs boîtes : dupliquer. Ctrl/Cmd + clic pour composer la sélection.
	</p>
	{#if presentation === 'menu'}<button
			type="button"
			disabled={selected.length === 0}
			aria-haspopup="menu"
			aria-expanded={menu}
			onclick={(event) => {
				opener = event.currentTarget;
				trigger = event.currentTarget;
				menu = !menu;
			}}><Icon name="phosphor:dots-three" /> Ouvrir les actions</button
		>
		<p>Accessible par ce bouton ou par clic droit sur une boîte.</p>{/if}
</div>
{#if selected.length > 0 && !session.editing && (presentation !== 'menu' || menu)}
	<FloatingActions
		{anchor}
		{trigger}
		fixed={presentation === 'fixed'}
		menu={presentation === 'menu'}
		label="Actions de la sélection"
		bind:element={bar}
		onclose={close}
	>
		{#if presentation !== 'menu'}<span class="count">{selected.length} boîte(s)</span>{/if}
		<button
			class="action"
			type="button"
			role={actionRole}
			tabindex={actionTabIndex}
			disabled={selected.length !== 1 && presentation !== 'menu'}
			aria-disabled={selected.length !== 1}
			aria-keyshortcuts="e"
			title="Éditer (E)"
			onclick={() => {
				if (selected.length !== 1) return;
				menu = false;
				if (node) session.beginNodeMarkdownEdit(node);
			}}><Icon name="phosphor:pencil-simple" /><span><u>É</u>diter</span></button
		>
		<button
			class="action"
			type="button"
			role={actionRole}
			tabindex={actionTabIndex}
			onclick={() => {
				duplicate();
				close(true);
			}}><Icon name="phosphor:copy" /> Dupliquer</button
		>
	</FloatingActions>
{/if}

<style>
	.count {
		font-size: 10px;
		color: var(--ui-muted);
		padding: 0 4px;
	}
	.action {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 8px 10px;
		border-radius: 6px;
		font-size: 12px;
		text-align: left;
		background: var(--ui-subtle);
	}
	.action:disabled,
	.action[aria-disabled='true'] {
		opacity: 0.35;
	}
	.action:focus-visible {
		outline: 2px solid var(--ui-accent);
		outline-offset: 2px;
	}
</style>
