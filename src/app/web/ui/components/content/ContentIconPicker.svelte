<script lang="ts">
	import { isIconAvailable } from '../../icons/phosphor';
	import type { PhosphorIconChoice } from '../../icons/phosphor-catalogue';
	import Icon from '../ui/Icon.svelte';
	let { value, onchange }: { value: string; onchange: (value: string) => void } = $props();
	const PAGE = 36;
	/** Shown before the catalogue loads; their labels follow the catalogue's naming. */
	const suggested: readonly PhosphorIconChoice[] = [
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
		'chart-bar',
		'diamond',
		'heart',
		'star',
		'tree-structure',
		'book-open',
		'flask',
		'compass',
		'globe',
		'cube',
		'key',
		'sparkle',
		'shield-check',
		'puzzle-piece',
		'rocket',
	].map((name) => ({
		id: `phosphor:${name}`,
		label: name.replaceAll('-', ' '),
		search: name.replaceAll('-', ' '),
	}));
	let loading = $state(false);
	let loadError = $state(false);
	let catalogue = $state<readonly PhosphorIconChoice[]>();
	let search = $state('');
	let limit = $state(PAGE);
	let query = $derived(search.trim().toLowerCase());
	/** The full catalogue is a separate chunk: it loads on the first search or « plus ». */
	async function loadCatalogue(): Promise<void> {
		if (catalogue !== undefined || loading) return;
		loading = true;
		loadError = false;
		try {
			const module = await import('../../icons/phosphor-catalogue');
			catalogue = module.phosphorIcons;
		} catch {
			loadError = true;
		} finally {
			loading = false;
		}
	}
	let matches = $derived.by((): readonly PhosphorIconChoice[] => {
		if (catalogue === undefined) {
			if (query === '') return suggested;
			return suggested.filter((icon) => icon.search.includes(query));
		}
		if (query !== '') return catalogue.filter((icon) => icon.search.includes(query));
		const rest = catalogue
			.filter((icon) => !suggested.some(({ id }) => id === icon.id))
			.sort((left, right) => left.label.localeCompare(right.label));
		return [...suggested, ...rest];
	});
	let visible = $derived(matches.slice(0, limit));
	let more = $derived(catalogue === undefined || matches.length > limit);
	function count(total: number, qualifier: string): string {
		if (total === 1) return `1 icône ${qualifier}`;
		return `${total} icônes ${qualifier}`;
	}
	let status = $derived.by(() => {
		if (loading) return 'Chargement du catalogue…';
		if (catalogue === undefined) return count(suggested.length, 'suggérées · noms en anglais');
		return count(matches.length, '· noms du catalogue en anglais');
	});
	function showMore(): void {
		if (catalogue === undefined) void loadCatalogue();
		else limit += 2 * PAGE;
	}
</script>

<div class="icon-picker">
	<label class="search"
		><Icon name="phosphor:magnifying-glass" /><input
			type="search"
			aria-label="Rechercher une icône"
			placeholder="Rechercher dans Phosphor : lightning, target, scales…"
			bind:value={search}
			onfocus={() => void loadCatalogue()}
			oninput={() => {
				limit = PAGE;
			}}
		/></label
	>
	<div class="icons" role="group" aria-label="Icônes Phosphor">
		<button
			type="button"
			class="none"
			aria-label="Sans icône"
			title="Sans icône"
			aria-pressed={value === 'none'}
			onclick={() => {
				onchange('none');
			}}><Icon name="phosphor:prohibit" size={20} /></button
		>
		{#each visible as icon (icon.id)}
			<button
				type="button"
				title={icon.label}
				aria-label={icon.label}
				aria-pressed={value === icon.id}
				onclick={() => {
					onchange(icon.id);
				}}><Icon name={icon.id} size={20} /></button
			>
		{/each}
	</div>
	<div class="foot">
		{#if loadError}<p class="unavailable" role="alert">Le catalogue n’a pas pu être chargé.</p>
		{:else}<p role="status">{status}</p>{/if}
		{#if value !== 'none' && !isIconAvailable(value)}<p class="unavailable">
				Icône indisponible ici. Sa référence est conservée dans le document.
			</p>{/if}
		{#if more && !loadError}<button class="ui-action more" type="button" onclick={showMore}
				>Afficher plus d’icônes</button
			>{/if}
	</div>
</div>

<style>
	.icon-picker {
		display: grid;
		gap: 8px;
		font-size: 11px;
	}
	.search {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 0 10px;
		border: 1px solid var(--ui-border);
		border-radius: 8px;
		background: var(--ui-surface);
		color: var(--ui-muted);
	}
	.search:focus-within {
		outline: 2px solid var(--ui-accent);
		outline-offset: 2px;
	}
	.search input {
		flex: 1;
		min-width: 0;
		padding: 8px 0;
		border: 0;
		background: transparent;
		color: var(--ui-text);
		font-size: 12px;
	}
	.search input:focus {
		outline: none;
	}
	.icons {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(34px, 1fr));
		gap: 4px;
		max-height: 214px;
		overflow: auto;
		padding: 2px;
	}
	.icons button {
		display: grid;
		place-items: center;
		aspect-ratio: 1;
		padding: 0;
		border: 1px solid transparent;
		border-radius: 8px;
		background: transparent;
		color: var(--ui-text);
		cursor: pointer;
	}
	.icons button:hover {
		border-color: var(--ui-border);
		background: var(--ui-subtle);
	}
	.icons button[aria-pressed='true'] {
		border-color: var(--ui-accent);
		background: var(--ui-accent-soft);
		color: var(--ui-accent);
	}
	.none {
		color: var(--ui-muted);
	}
	.icons button:focus-visible {
		outline: 2px solid var(--ui-accent);
		outline-offset: 2px;
	}
	.foot {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}
	.foot p {
		margin: 0;
		color: var(--ui-muted);
	}
	.unavailable {
		color: var(--ui-warning);
	}
	.more {
		font-size: 11px;
	}
</style>
