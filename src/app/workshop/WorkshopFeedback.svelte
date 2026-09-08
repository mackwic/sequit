<script lang="ts">
	import { onMount } from 'svelte';

	import DownloadButton from './DownloadButton.svelte';
	import {
		emptyFeedback,
		parseWorkshopFeedback,
		type WorkshopFeedbackEntry,
		workshopFeedbackMarkdown,
	} from './runtime/workshop-feedback';
	import type { WorkshopScenario } from './workshop-types';
	let {
		scenario,
		scenarios,
		trial,
	}: { scenario: WorkshopScenario; scenarios: readonly WorkshopScenario[]; trial: string } =
		$props();
	const records = $state<Record<string, WorkshopFeedbackEntry>>({});
	let loaded = $state(false);
	let persistence = $state('');
	let entry = $derived(records[scenario.id] ?? emptyFeedback);
	const storageKey = 'sequit-workshop-feedback-v1';
	const unavailable = 'Stockage indisponible. Télécharge tes remarques pour les garder.';
	onMount(() => {
		try {
			Object.assign(records, parseWorkshopFeedback(localStorage.getItem(storageKey)));
		} catch {
			persistence = unavailable;
		}
		loaded = true;
		const receive = (event: StorageEvent) => {
			if (event.key !== storageKey) return;
			try {
				Object.assign(records, parseWorkshopFeedback(event.newValue));
			} catch {
				persistence = unavailable;
			}
		};
		window.addEventListener('storage', receive);
		return () => {
			window.removeEventListener('storage', receive);
		};
	});
	function save(changes: Partial<WorkshopFeedbackEntry>) {
		if (!loaded) return;
		const edited = { ...entry, ...changes };
		try {
			Object.assign(records, parseWorkshopFeedback(localStorage.getItem(storageKey)));
			records[scenario.id] = edited;
			localStorage.setItem(storageKey, JSON.stringify(records));
			persistence = 'Remarques enregistrées dans ce navigateur.';
		} catch {
			records[scenario.id] = edited;
			persistence = unavailable;
		}
	}
	function recordTrial() {
		const trials = entry.tested.split('; ').filter(Boolean);
		if (!trials.includes(trial)) trials.push(trial);
		save({ tested: trials.join('; ') });
	}
	let markdown = $derived(workshopFeedbackMarkdown(scenarios, records));
</script>

<details class="feedback">
	<summary>Terminer ce parcours · mes remarques</summary>
	<div class="feedback-body">
		<p>
			Compare après les essais. Les remarques restent ici quand tu changes de scénario ou
			recommences.
		</p>
		<button type="button" class="record-trial" disabled={!loaded} onclick={recordTrial}
			>Noter cet essai : {trial}</button
		>
		<div class="feedback-grid">
			<label
				>Variantes essayées<input
					value={entry.tested}
					disabled={!loaded}
					oninput={(event) => {
						save({ tested: event.currentTarget.value });
					}}
					placeholder={scenario.variants.map((item) => item.id).join(', ')}
				/></label
			>
			<label
				>Préférence<select
					aria-label="Préférence"
					value={entry.preference}
					disabled={!loaded}
					onchange={(event) => {
						save({ preference: event.currentTarget.value });
					}}
					><option value="">Pas encore décidé</option
					>{#each scenario.variants as variant (variant.id)}<option value={variant.id}
							>{variant.label}</option
						>{/each}<option value="mélange">Un mélange</option><option value="aucune">Aucune</option
					></select
				></label
			>
			<label
				>Ce qui aide / ce qui gêne<textarea
					rows="3"
					value={entry.notes}
					disabled={!loaded}
					oninput={(event) => {
						save({ notes: event.currentTarget.value });
					}}
					placeholder="Un geste, une hésitation, une surprise…"></textarea></label
			>
			<label
				>À changer au prochain essai<textarea
					rows="3"
					value={entry.next}
					disabled={!loaded}
					oninput={(event) => {
						save({ next: event.currentTarget.value });
					}}></textarea></label
			>
		</div>
		<div class="feedback-actions">
			<span role="status">{persistence}</span><DownloadButton
				content={markdown}
				filename="sequit-atelier-retours.md"
				label="Télécharger toutes les fiches (.md)"
			/>
		</div>
	</div>
</details>

<style>
	.feedback {
		margin-top: 18px;
		border: 1px solid #dedad3;
		border-radius: 10px;
		font-size: 12px;
		background: #fff;
	}
	.feedback summary {
		padding: 13px 16px;
		cursor: pointer;
		font-weight: 600;
	}
	.feedback-body {
		padding: 0 16px 16px;
	}
	.feedback-body > p {
		color: #78716c;
		margin-bottom: 12px;
		line-height: 1.6;
	}
	.record-trial {
		margin-bottom: 12px;
		padding: 8px;
		border: 1px solid #d6d3d1;
		border-radius: 7px;
		cursor: pointer;
	}
	.feedback-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 12px;
	}
	.feedback label {
		display: flex;
		flex-direction: column;
		gap: 7px;
		color: #57534e;
	}
	.feedback input,
	.feedback select,
	.feedback textarea {
		padding: 9px;
		border: 1px solid #d6d3d1;
		border-radius: 7px;
		background: #faf9f6;
		resize: vertical;
	}
	.feedback-actions {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 12px;
		margin-top: 12px;
	}
	.feedback-actions span {
		font-size: 11px;
		color: #78716c;
	}
	.feedback-actions :global(button) {
		padding: 9px 12px;
		border: 1px solid #d6d3d1;
		border-radius: 7px;
		cursor: pointer;
		white-space: nowrap;
	}
	@media (max-width: 700px) {
		.feedback-grid {
			grid-template-columns: 1fr;
		}
		.feedback-actions {
			align-items: flex-start;
			flex-direction: column;
		}
	}
</style>
