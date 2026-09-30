<script lang="ts">
	import type { ParticipantPresence } from '../../../../../lib/infrastructure/collaboration/participant-presence';

	const SHOWN = 5;

	let {
		participants,
		selfId,
		following,
		onfollow,
	}: {
		participants: readonly ParticipantPresence[];
		selfId: number;
		/** The participant currently followed on the canvas. */
		following?: number | undefined;
		onfollow?: ((clientId: number) => void) | undefined;
	} = $props();
	let ordered = $derived([
		...participants.filter(({ clientId }) => clientId === selfId),
		...participants.filter(({ clientId }) => clientId !== selfId),
	]);
	let shown = $derived(ordered.slice(0, SHOWN));
	let hidden = $derived(ordered.slice(SHOWN));

	function initials(name: string): string {
		const words = name.trim().split(/\s+/).filter(Boolean);
		const first = words[0]?.[0] ?? '?';
		let last = '';
		if (words.length > 1) last = words.at(-1)?.[0] ?? '';
		return `${first}${last}`.toUpperCase();
	}

	function followLabel(participant: ParticipantPresence): string {
		if (participant.clientId === following) return `Ne plus suivre ${participant.name}`;
		return `Suivre ${participant.name}`;
	}
</script>

<ul class="avatars" aria-label="Participants">
	{#each shown as participant (participant.clientId)}
		<li aria-label={participant.name}>
			{#if participant.clientId === selfId || onfollow === undefined}
				<span class="avatar" style:background={participant.color} title={participant.name}>
					<span aria-hidden="true">{initials(participant.name)}</span>
				</span>
			{:else}
				<button
					class="avatar"
					class:followed={participant.clientId === following}
					type="button"
					style:background={participant.color}
					title={followLabel(participant)}
					aria-label={followLabel(participant)}
					aria-pressed={participant.clientId === following}
					onclick={() => {
						onfollow(participant.clientId);
					}}
				>
					<span aria-hidden="true">{initials(participant.name)}</span>
				</button>
			{/if}
		</li>
	{/each}
	{#if hidden.length > 0}
		<li
			class="avatar more"
			title={hidden.map(({ name }) => name).join(', ')}
			aria-label={`${String(hidden.length)} autres participants : ${hidden.map(({ name }) => name).join(', ')}`}
		>
			<span aria-hidden="true">+{hidden.length}</span>
		</li>
	{/if}
</ul>

<style>
	.avatars {
		display: flex;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	li {
		margin-left: -6px;
	}
	li:first-child {
		margin-left: 0;
	}
	.avatar {
		display: grid;
		place-items: center;
		width: 28px;
		height: 28px;
		padding: 0;
		border: 2px solid var(--ui-surface);
		border-radius: 999px;
		color: white;
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 0.02em;
	}
	button.avatar {
		cursor: pointer;
	}
	button.avatar:focus-visible {
		outline: 2px solid var(--ui-accent);
		outline-offset: 2px;
	}
	.followed {
		box-shadow: 0 0 0 2px var(--ui-accent);
	}
	.more {
		background: var(--ui-muted);
	}
</style>
