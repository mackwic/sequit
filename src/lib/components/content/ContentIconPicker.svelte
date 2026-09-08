<script lang="ts">
	import { iconUrl } from '$lib/icons/phosphor';
	import type { PhosphorIconChoice } from '$lib/icons/phosphor-catalogue';

	import Icon from '../ui/Icon.svelte';
	let { value, onchange }: { value: string; onchange: (value: string) => void } = $props();
	let loading = $state(false);
	let loadError = $state(false);
	let phosphorIcons = $state<readonly PhosphorIconChoice[]>([]);
	async function loadCatalogue() {
		loading = true;
		loadError = false;
		try {
			const catalogue = await import('$lib/icons/phosphor-catalogue');
			phosphorIcons = catalogue.phosphorIcons;
		} catch {
			loadError = true;
		} finally {
			loading = false;
		}
	}
	function toggle(event: Event) {
		if (!(event.currentTarget instanceof HTMLDetailsElement)) return;
		if (event.currentTarget.open && phosphorIcons.length === 0 && !loading && !loadError)
			void loadCatalogue();
	}

	let search = $state('');
	let limit = $state(36);
	const suggested = [
		'lightning',
		'target',
		'scales',
		'lightbulb',
		'flag',
		'check-circle',
		'warning',
		'chat-circle',
		'note',
		'question',
		'link',
		'users',
		'gear',
		'clock',
		'chart-line-up',
		'diamond',
		'heart',
		'star',
		'tree-structure',
		'book-open',
		'flask',
		'compass',
		'globe',
		'cube',
	];
	let matches = $derived.by(() => {
		const query = search.trim().toLowerCase();
		if (query) return phosphorIcons.filter((icon) => icon.search.includes(query));
		return [...phosphorIcons].sort((left, right) => {
			const a = suggested.indexOf(left.id.slice('phosphor:'.length));
			const b = suggested.indexOf(right.id.slice('phosphor:'.length));
			if (a === -1 && b === -1) return left.label.localeCompare(right.label);
			if (a === -1) return 1;
			if (b === -1) return -1;
			return a - b;
		});
	});
</script>

<details class="icon-picker" ontoggle={toggle}>
	<summary
		><Icon name={value} /> Icône · {#if value === 'none'}Sans icône{:else}{value.replace(
				'phosphor:',
				'',
			)}{/if}</summary
	>
	<label
		>Rechercher dans Phosphor<input
			type="search"
			aria-label="Rechercher une icône"
			placeholder="lightning, target, scales…"
			bind:value={search}
			oninput={() => {
				limit = 36;
			}}
		/></label
	>
	{#if loading}<p role="status">Chargement du catalogue…</p>{:else if loadError}<p
			class="unavailable"
			role="alert"
		>
			Le catalogue n’a pas pu être chargé.
		</p>
	{:else}<p>{matches.length} icônes · noms du catalogue en anglais</p>{/if}
	{#if value !== 'none' && iconUrl(value) === undefined}<p class="unavailable">
			Icône indisponible ici. Sa référence est conservée dans le document.
		</p>{/if}
	<button
		class="ui-action"
		type="button"
		aria-pressed={value === 'none'}
		onclick={() => {
			onchange('none');
		}}><Icon name="phosphor:prohibit" /> Sans icône</button
	>
	<div class="icons" role="group" aria-label="Icônes Phosphor">
		{#each matches.slice(0, limit) as icon (icon.id)}
			<button
				type="button"
				title={icon.label}
				aria-label={icon.label}
				aria-pressed={value === icon.id}
				onclick={() => {
					onchange(icon.id);
				}}><Icon name={icon.id} size={21} /></button
			>
		{/each}
	</div>
	{#if matches.length > limit}<button
			class="ui-action"
			type="button"
			onclick={() => {
				limit += 72;
			}}>Afficher plus d’icônes</button
		>{/if}
</details>

<style>
	.icon-picker {
		font-size: 11px;
	}
	summary {
		overflow-wrap: anywhere;
		cursor: pointer;
		display: flex;
		align-items: center;
		gap: 8px;
		min-height: 32px;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 6px;
		margin-top: 10px;
	}
	input {
		border: 1px solid var(--ui-border);
		padding: 8px;
		border-radius: 6px;
		background: var(--ui-surface);
		color: var(--ui-text);
		width: 100%;
	}
	p {
		color: var(--ui-muted);
		margin: 8px 0;
	}
	.unavailable {
		color: var(--ui-warning);
	}
	.icons {
		display: grid;
		grid-template-columns: repeat(6, 1fr);
		gap: 4px;
		margin: 10px 0;
	}
	.icons button {
		display: grid;
		place-items: center;
		min-height: 34px;
		padding: 4px;
		border: 1px solid var(--ui-border);
		border-radius: 6px;
		background: var(--ui-surface);
		color: var(--ui-text);
		cursor: pointer;
	}
	button[aria-pressed='true'] {
		border-color: var(--ui-accent);
		background: var(--ui-accent-soft);
		color: var(--ui-accent);
	}
	button:focus-visible,
	input:focus-visible,
	summary:focus-visible {
		outline: 2px solid var(--ui-accent);
		outline-offset: 2px;
	}
</style>
