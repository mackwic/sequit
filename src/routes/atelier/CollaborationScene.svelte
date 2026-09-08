<script lang="ts">
	import { onMount } from 'svelte';

	import CollaborationParticipant from './CollaborationParticipant.svelte';
	import type { WorkshopSceneProps } from './workshop-types';
	let { source, presentation = 'ambient' }: WorkshopSceneProps = $props();
	let room = $state('');
	let alice = $state('');
	let bob = $state('');
	onMount(() => {
		room = `workshop-${crypto.randomUUID()}`;
	});
</script>

<div class="collaboration-scene">
	<p>
		Deux sessions indépendantes. Sélectionne et édite dans chaque vue ; mets-en une hors ligne puis
		reconnecte-la. Les brouillons en attente repartent à la reprise.
	</p>
	{#if room}<div class="participants">
			<CollaborationParticipant
				{source}
				{room}
				{presentation}
				name="Alice"
				peer={bob}
				onpresence={(value: string) => {
					alice = value;
				}}
			/><CollaborationParticipant
				{source}
				{room}
				{presentation}
				name="Bob"
				peer={alice}
				onpresence={(value: string) => {
					bob = value;
				}}
			/>
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
