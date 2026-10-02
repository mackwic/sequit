<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';

	import { m } from '../../../i18n/paraglide/messages';
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
		if (join) return m.collaboration_start_join_description();
		return m.collaboration_start_description();
	}

	function actionFor(join: boolean): string {
		if (join) return m.collaboration_start_join_action();
		return m.collaboration_start_action();
	}

	onMount(() => {
		void tick().then(() => input?.focus());
	});

	function start(): void {
		if (!ready) return;
		onstart(normalizeParticipantName(draft));
	}
</script>

<ModalDialog title={m.collaboration_start_title()} {description} {onclose} oncommit={start}>
	<form
		id={`collaboration-start-${inputId}`}
		class="fields"
		onsubmit={(event) => {
			event.preventDefault();
			start();
		}}
	>
		<label class="ui-label" for={inputId}>{m.collaboration_start_name_label()}</label>
		<input
			class="ui-field"
			id={inputId}
			type="text"
			autocomplete="nickname"
			maxlength={PARTICIPANT_NAME_LIMIT}
			placeholder={m.collaboration_start_name_placeholder()}
			bind:this={input}
			bind:value={draft}
		/>
		<p class="m-0 text-xs text-[var(--ui-muted)]">
			{m.collaboration_start_name_hint()}
		</p>
	</form>
	{#snippet footer()}
		<button class="ui-action" type="button" onclick={onclose}>
			<Icon name="phosphor:x" />
			{m.common_cancel()}
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
