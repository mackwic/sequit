<script lang="ts">
	import type { VirtualElement } from '@floating-ui/dom';
	import { untrack } from 'svelte';

	import { m } from '../../../i18n/paraglide/messages';
	import {
		CANVAS_SHORTCUTS,
		type CanvasShortcut,
		CanvasShortcutId,
		matchesShortcut,
		shortcutKeyshortcuts,
		shortcutTitle,
	} from '../../canvas/canvas-shortcuts';
	import Icon from '../ui/Icon.svelte';
	import Kbd from '../ui/Kbd.svelte';
	import FloatingActions from './FloatingActions.svelte';
	import type { NodeDraftControls } from './node-typing.svelte';

	let {
		draft,
		viewportElement,
	}: {
		/** The box this bar was opened for; the bar never acts on a later one. */
		draft: NodeDraftControls;
		viewportElement: HTMLDivElement;
	} = $props();
	// The props follow the box being typed, which changes as soon as this one is done with.
	const own = untrack(() => draft);
	const viewport = untrack(() => viewportElement);
	interface TypingAction {
		readonly shortcut: CanvasShortcut;
		/** The same words as the bar of the selected box: only the keys change while typing. */
		readonly label: string;
		readonly icon: string;
		readonly run: () => void;
		readonly primary?: true;
	}
	let floating = $state<HTMLDivElement>();
	const actions: readonly TypingAction[] = [
		{
			shortcut: CANVAS_SHORTCUTS[CanvasShortcutId.Confirm],
			label: m.canvas_shortcut_confirm(),
			icon: 'phosphor:check',
			run: own.commit,
			primary: true,
		},
		{
			shortcut: CANVAS_SHORTCUTS[CanvasShortcutId.DraftChild],
			label: m.canvas_shortcut_create_child(),
			icon: 'phosphor:tree-structure',
			run: own.child,
		},
		{
			shortcut: CANVAS_SHORTCUTS[CanvasShortcutId.DraftEdit],
			label: m.canvas_shortcut_edit(),
			icon: 'phosphor:sliders-horizontal',
			run: own.edit,
		},
		{
			shortcut: CANVAS_SHORTCUTS[CanvasShortcutId.Cancel],
			label: m.common_cancel(),
			icon: 'phosphor:x',
			run: own.cancel,
		},
	];

	function card(): Element | null {
		return viewport.querySelector(`[data-node-draft="${CSS.escape(own.id)}"]`);
	}
	/** Where the bar of the selected box sits: above the box, which grows downwards as it is typed. */
	const anchor: VirtualElement = {
		contextElement: viewport,
		getBoundingClientRect: () => card()?.getBoundingClientRect() ?? new DOMRect(),
	};
	function inside(target: EventTarget | null): boolean {
		if (!(target instanceof Node)) return false;
		return card()?.contains(target) === true || floating?.contains(target) === true;
	}
	/**
	 * The box goes away with its editor: the canvas takes focus so that its keys, such as N, keep
	 * working, until the created box, the next box or the dialog takes it.
	 */
	function perform(action: TypingAction): void {
		action.run();
		viewport.focus({ preventScroll: true });
	}
	/** Captured before the editor and the canvas: these keys belong to the box being typed. */
	function keydown(event: KeyboardEvent): void {
		if (!inside(event.target)) return;
		const action = actions.find(({ shortcut }) => matchesShortcut(shortcut, event));
		if (action === undefined) return;
		event.preventDefault();
		event.stopPropagation();
		perform(action);
	}
	function leaveFrom(event: Event): void {
		if (!inside(event.target)) own.leave();
	}
</script>

<svelte:window
	onkeydowncapture={keydown}
	onpointerdowncapture={leaveFrom}
	onfocusincapture={leaveFrom}
/>

<FloatingActions
	{anchor}
	boundary={viewport}
	label={m.editing_draft_actions()}
	bind:element={floating}
>
	{#each actions as action (action.shortcut.id)}
		<button
			class="ui-action"
			class:primary={action.primary === true}
			class:quiet={action.primary !== true}
			type="button"
			title={shortcutTitle(action.shortcut)}
			aria-keyshortcuts={shortcutKeyshortcuts(action.shortcut)}
			onclick={() => {
				perform(action);
			}}
		>
			<Icon name={action.icon} />
			<span>{action.label}</span>
			<Kbd shortcut={action.shortcut} />
		</button>
	{/each}
</FloatingActions>
