<script lang="ts">
	import { tick } from 'svelte';

	import type { LogicGroup } from '../../../../../lib/core/document/logic-document';
	import ContentColorPicker from '../content/ContentColorPicker.svelte';
	import Icon from '../ui/Icon.svelte';

	let {
		group,
		saving = false,
		onclose,
		onsave,
	}: {
		group: LogicGroup;
		saving?: boolean;
		onclose: () => void;
		onsave: (label: string, color: string) => void;
	} = $props();
	const dialogId = $props.id();
	let dialog = $state<HTMLDialogElement>();
	let title = $state('');
	let color = $state('#78716c');
	let opened = false;

	$effect(() => {
		const current = dialog;
		if (!current || opened) return;
		opened = true;
		title = group.label;
		color = group.color ?? '#78716c';
		current.showModal();
		void tick().then(() => current.querySelector<HTMLInputElement>('[data-group-title]')?.focus());
	});

	function cancel(event: Event): void {
		event.preventDefault();
		if (!saving) onclose();
	}

	function submit(event: SubmitEvent): void {
		event.preventDefault();
		if (!saving && title.trim() !== '') onsave(title.trim(), color);
	}
</script>

<dialog
	class="pointer-events-auto m-auto w-[min(34rem,calc(100vw-2rem))] max-w-none overflow-hidden rounded-2xl border border-stone-300 bg-white p-0 text-stone-950 shadow-2xl"
	data-group-editor={group.id}
	aria-modal="true"
	aria-labelledby={`group-editor-title-${dialogId}`}
	bind:this={dialog}
	oncancel={cancel}
	onclick={(event) => {
		if (event.target === dialog && !saving) onclose();
	}}
>
	<form onsubmit={submit}>
		<header class="border-b border-stone-200 bg-stone-50 px-6 py-5 max-sm:px-4">
			<p class="m-0 text-xs font-bold tracking-[0.12em] text-stone-500 uppercase">Groupe</p>
			<h2 class="mt-1 mb-0 text-xl font-semibold" id={`group-editor-title-${dialogId}`}>
				Modifier le groupe
			</h2>
		</header>
		<div class="grid gap-5 px-6 py-5 max-sm:px-4">
			<label class="grid gap-2 text-sm font-semibold text-stone-700">
				Titre
				<input
					class="rounded-lg border border-stone-300 bg-white px-3 py-2 text-base font-normal text-stone-950 outline-none focus:border-stone-950 focus:ring-2 focus:ring-stone-950/20"
					data-group-title
					aria-label="Titre du groupe"
					value={title}
					disabled={saving}
					oninput={(event) => {
						title = event.currentTarget.value;
					}}
				/>
			</label>
			<div>
				<p class="mb-2 text-sm font-semibold text-stone-700">Couleur</p>
				<ContentColorPicker
					value={color}
					onchange={(value: string) => {
						color = value;
					}}
				/>
			</div>
		</div>
		<footer
			class="flex justify-end gap-3 border-t border-stone-200 bg-stone-50 px-6 py-4 max-sm:px-4"
		>
			<button
				class="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-stone-700 hover:bg-stone-200"
				type="button"
				disabled={saving}
				onclick={onclose}
			>
				<Icon name="phosphor:x" /> Annuler
			</button>
			<button
				class="inline-flex items-center gap-2 rounded-lg bg-[var(--ui-accent)] px-5 py-2 text-sm font-semibold text-white disabled:opacity-45"
				type="submit"
				disabled={saving || title.trim() === ''}
			>
				<Icon name="phosphor:check" />
				{#if saving}Enregistrement…{:else}Enregistrer{/if}
			</button>
		</footer>
	</form>
</dialog>

<style>
	dialog::backdrop {
		background: rgb(28 25 23 / 0.58);
		backdrop-filter: blur(2px);
	}
</style>
