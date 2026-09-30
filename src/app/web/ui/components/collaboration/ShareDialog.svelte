<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';

	import {
		normalizeParticipantName,
		PARTICIPANT_NAME_LIMIT,
	} from '../../document/participant-name';
	import Icon from '../ui/Icon.svelte';
	import ModalDialog from '../ui/ModalDialog.svelte';

	let {
		link,
		name,
		onrename,
		onleave,
		onclose,
	}: {
		link: string;
		name: string;
		onrename: (name: string) => void;
		onleave: () => void;
		onclose: () => void;
	} = $props();
	const id = $props.id();
	let draft = $state(untrack(() => name));
	let linkField = $state<HTMLInputElement>();
	let copied = $state(false);
	let copyFailed = $state(false);
	let copyTimer: ReturnType<typeof setTimeout> | undefined;

	onMount(() => {
		void tick().then(() => {
			linkField?.focus();
			linkField?.select();
		});
		return () => {
			clearTimeout(copyTimer);
		};
	});

	async function copy(): Promise<void> {
		copyFailed = false;
		try {
			await navigator.clipboard.writeText(link);
			copied = true;
		} catch {
			// Clipboard access can be refused: leave the selected link for a manual copy.
			copyFailed = true;
			linkField?.focus();
			linkField?.select();
			return;
		}
		clearTimeout(copyTimer);
		copyTimer = setTimeout(() => {
			copied = false;
		}, 2000);
	}

	function rename(): void {
		const next = normalizeParticipantName(draft);
		if (next === '' || next === name) {
			draft = name;
			return;
		}
		onrename(next);
	}
</script>

<ModalDialog
	title="Session collaborative"
	description="Toute personne qui possède ce lien peut lire et modifier le document en direct."
	{onclose}
>
	<div class="fields">
		<label class="ui-label" for={`share-link-${id}`}>Lien de la session</label>
		<div class="link">
			<input
				class="ui-field"
				id={`share-link-${id}`}
				type="text"
				readonly
				value={link}
				bind:this={linkField}
				onfocus={(event) => {
					event.currentTarget.select();
				}}
			/>
			<button class="ui-action primary" type="button" onclick={() => void copy()}>
				{#if copied}<Icon name="phosphor:check" /> Lien copié{:else}<Icon name="phosphor:link" /> Copier
					le lien{/if}
			</button>
		</div>
		<p class="m-0 text-xs text-[var(--ui-muted)]" role="status" aria-live="polite">
			{#if copied}Le lien est dans le presse-papiers.{:else if copyFailed}Copie refusée par le
				navigateur : le lien est sélectionné, copie-le manuellement.{:else}Partage-le aux personnes
				qui doivent participer.{/if}
		</p>
		<label class="ui-label" for={`share-name-${id}`}>Ton nom</label>
		<input
			class="ui-field"
			id={`share-name-${id}`}
			type="text"
			autocomplete="nickname"
			maxlength={PARTICIPANT_NAME_LIMIT}
			bind:value={draft}
			onblur={rename}
			onkeydown={(event) => {
				if (event.key !== 'Enter') return;
				event.preventDefault();
				rename();
			}}
		/>
	</div>
	{#snippet footer()}
		<button class="ui-action danger" type="button" onclick={onleave}>
			<Icon name="phosphor:sign-out" /> Quitter la session
		</button>
		<button class="ui-action" type="button" onclick={onclose}>
			<Icon name="phosphor:x" /> Fermer
		</button>
	{/snippet}
</ModalDialog>

<style>
	.fields {
		display: grid;
		gap: 8px;
	}
	.link {
		display: flex;
		gap: 8px;
	}
	.link input {
		flex: 1;
		min-width: 0;
	}
	.link button {
		flex: none;
		white-space: nowrap;
	}
</style>
