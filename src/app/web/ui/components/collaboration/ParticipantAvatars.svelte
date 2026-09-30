<script lang="ts">
	import type { ParticipantPresence } from '../../../../../lib/infrastructure/collaboration/participant-presence';

	const SHOWN = 5;

	let { participants, selfId }: { participants: readonly ParticipantPresence[]; selfId: number } =
		$props();
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
</script>

<ul class="avatars" aria-label="Participants">
	{#each shown as participant (participant.clientId)}
		<li
			class="avatar"
			style:background={participant.color}
			title={participant.name}
			aria-label={participant.name}
		>
			<span aria-hidden="true">{initials(participant.name)}</span>
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
	.avatar {
		display: grid;
		place-items: center;
		width: 28px;
		height: 28px;
		margin-left: -6px;
		border: 2px solid var(--ui-surface);
		border-radius: 999px;
		color: white;
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 0.02em;
	}
	.avatar:first-child {
		margin-left: 0;
	}
	.more {
		background: var(--ui-muted);
	}
</style>
