<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';

	import {
		normalizeParticipantName,
		PARTICIPANT_NAME_LIMIT,
	} from '../../document/participant-name';
	import Icon from '../ui/Icon.svelte';
	import ModalDialog from '../ui/ModalDialog.svelte';

	let {
		name,
		joining = false,
		onstart,
		onclose,
	}: {
		name: string;
		/** Joining an existing session, rather than publishing the current document. */
		joining?: boolean;
		onstart: (name: string) => void;
		onclose: () => void;
	} = $props();
	const inputId = $props.id();
	let draft = $state(untrack(() => name));
	let input = $state<HTMLInputElement>();
	let ready = $derived(normalizeParticipantName(draft) !== '');
	let description = $derived(descriptionFor(joining));
	let action = $derived(actionFor(joining));

	function descriptionFor(join: boolean): string {
		if (join)
			return 'Tu vas rejoindre une session partagée : ses participants voient tes modifications en direct.';
		return 'Le document courant est publié dans une session partagée. Toute personne qui possède le lien peut le lire et le modifier en direct.';
	}

	function actionFor(join: boolean): string {
		if (join) return 'Rejoindre la session';
		return 'Démarrer la session';
	}

	onMount(() => {
		void tick().then(() => input?.focus());
	});

	function start(): void {
		if (!ready) return;
		onstart(normalizeParticipantName(draft));
	}
</script>

<ModalDialog title="Session collaborative" {description} {onclose} oncommit={start}>
	<form
		id={`collaboration-start-${inputId}`}
		class="fields"
		onsubmit={(event) => {
			event.preventDefault();
			start();
		}}
	>
		<label class="ui-label" for={inputId}>Ton nom</label>
		<input
			class="ui-field"
			id={inputId}
			type="text"
			autocomplete="nickname"
			maxlength={PARTICIPANT_NAME_LIMIT}
			placeholder="Tel que les autres participants le verront"
			bind:this={input}
			bind:value={draft}
		/>
		<p class="m-0 text-xs text-[var(--ui-muted)]">
			Le nom accompagne ton pointeur et tes sélections. Il reste modifiable pendant la session.
		</p>
	</form>
	{#snippet footer()}
		<button class="ui-action" type="button" onclick={onclose}>
			<Icon name="phosphor:x" /> Annuler
		</button>
		<button
			class="ui-action primary"
			type="submit"
			form={`collaboration-start-${inputId}`}
			disabled={!ready}
		>
			<Icon name="phosphor:users" />
			{action}
		</button>
	{/snippet}
</ModalDialog>

<style>
	.fields {
		display: grid;
		gap: 8px;
	}
</style>
