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
	title={m.collaboration_share_title()}
	description={m.collaboration_share_description()}
	{onclose}
>
	<div class="fields">
		<label class="ui-label" for={`share-link-${id}`}>{m.collaboration_share_link_label()}</label>
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
				{#if copied}<Icon name="phosphor:check" /> {m.collaboration_share_copied()}{:else}<Icon
						name="phosphor:link"
					/>
					{m.collaboration_share_copy_link()}{/if}
			</button>
		</div>
		<p class="m-0 text-xs text-[var(--ui-muted)]" role="status" aria-live="polite">
			{#if copied}{m.collaboration_share_copied_status()}{:else if copyFailed}
				{m.collaboration_share_copy_failed_status()}{:else}{m.collaboration_share_share_hint()}{/if}
		</p>
		<label class="ui-label" for={`share-name-${id}`}>{m.collaboration_share_name_label()}</label>
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
			<Icon name="phosphor:sign-out" />
			{m.collaboration_share_leave()}
		</button>
		<button class="ui-action" type="button" onclick={onclose}>
			<Icon name="phosphor:x" />
			{m.collaboration_share_close()}
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
