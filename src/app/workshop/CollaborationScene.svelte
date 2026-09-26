<script lang="ts">
	import { onMount } from 'svelte';

	import { replaceState } from '$app/navigation';
	import { resolve } from '$app/paths';

	import CollaborationParticipant from './CollaborationParticipant.svelte';
	import type { WorkshopSceneProps } from './workshop-types';
	let { source }: WorkshopSceneProps = $props();
	let room = $state('');
	onMount(() => {
		const url = new URL(window.location.href);
		room = url.searchParams.get('room') ?? `workshop-${crypto.randomUUID()}`;
		url.searchParams.set('room', room);
		replaceState(resolve(`/atelier?${url.searchParams.toString()}${url.hash}`), {});
	});
</script>

<div class="collaboration-scene">
	<p>
		Deux sessions indépendantes. Sélectionne et édite dans chaque vue ; mets-en une hors ligne puis
		reconnecte-la. La saisie est partagée en continu et synchronisée à la reprise.
	</p>
	{#if room}<div class="participants">
			<CollaborationParticipant {source} {room} path="/atelier" name="Alice" />
			<CollaborationParticipant {source} {room} path="/atelier" name="Bob" />
		</div>{/if}
</div>

<style>
	.collaboration-scene {
		height: 100%;
		min-height: 540px;
		display: flex;
		flex-direction: column;
		padding: 12px;
		gap: 10px;
	}
	.collaboration-scene > p {
		font-size: 12px;
		color: #78716c;
		line-height: 1.5;
	}
	.participants {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 12px;
		flex: 1;
		min-height: 0;
	}
	@media (max-width: 700px) {
		.participants {
			grid-template-columns: 1fr;
		}
		.collaboration-scene {
			overflow: auto;
		}
	}
</style>
