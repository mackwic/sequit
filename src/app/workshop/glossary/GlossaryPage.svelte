<script lang="ts">
	import './glossary.css';

	import { onMount } from 'svelte';

	import { resolve } from '$app/paths';

	import {
		GLOSSARY_STATUSES,
		type GlossaryEntry,
		glossarySections,
		readGlossary,
		writeGlossary,
	} from './glossary';

	let base = $state('');
	let entries = $state<GlossaryEntry[]>([]);
	let selected = $state('');
	const removed = $state<GlossaryEntry[]>([]);
	let search = $state('');
	let family = $state('');
	let status = $state('');
	let message = $state('Chargement du document…');
	let busy = $state(false);
	let loaded = $state(false);
	let dirty = $derived(
		loaded && writeGlossary(base, entries) !== writeGlossary(base, readGlossary(base)),
	);
	let active = $derived(entries.find((entry) => entry.id === selected));
	let families = $derived.by(() => {
		if (!loaded) return [];
		return glossarySections(base);
	});
	let visible = $derived(
		entries.filter((entry) => {
			const text =
				`${entry.id} ${entry.fr} ${entry.en} ${entry.definition} ${entry.notes}`.toLocaleLowerCase();
			return (
				text.includes(search.toLocaleLowerCase()) &&
				(family === '' || entry.section === family) &&
				(status === '' || entry.status === status)
			);
		}),
	);
	let validated = $derived(entries.filter((entry) => entry.status === 'ok').length);

	onMount(() => {
		void load();
		const warn = (event: BeforeUnloadEvent) => {
			if (dirty) event.preventDefault();
		};
		window.addEventListener('beforeunload', warn);
		return () => {
			window.removeEventListener('beforeunload', warn);
		};
	});

	async function load() {
		try {
			const response = await fetch('/atelier/lexique/data');
			const data: unknown = await response.json();
			if (
				!response.ok ||
				typeof data !== 'object' ||
				data === null ||
				!('document' in data) ||
				typeof data.document !== 'string'
			)
				throw new Error('Lecture impossible.');
			base = data.document;
			entries = readGlossary(base);
			selected = window.location.hash.slice(1) || (entries[0]?.id ?? '');
			loaded = true;
			message = 'Document local chargé.';
		} catch {
			message = 'Impossible de charger le fichier. Réessaie en rechargeant la page.';
		}
	}

	async function save() {
		busy = true;
		try {
			const document = writeGlossary(base, entries);
			const response = await fetch('/atelier/lexique/data', {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ base, document }),
			});
			if (response.status === 409) {
				message =
					'Conflit : le fichier a changé ailleurs. Exporte ton brouillon avant de recharger ; aucune modification n’a été écrasée.';
				return;
			}
			if (!response.ok) throw new Error('Sauvegarde impossible.');
			base = document;
			message = 'Enregistré dans docs/visual-language.md.';
		} catch {
			message =
				'Échec de sauvegarde. Tes modifications restent dans cette page ; exporte ton brouillon pour les conserver.';
		} finally {
			busy = false;
		}
	}

	function select(id: string) {
		selected = id;
		window.history.replaceState(null, '', `#${id}`);
	}
	function add() {
		const section = family || (active?.section ?? families[0]);
		if (section === undefined) return;
		const entry: GlossaryEntry = {
			id: `VL-${crypto.randomUUID()}`,
			section,
			fr: 'Nouveau terme',
			en: '',
			definition: '',
			status: 'todo',
			notes: '',
		};
		entries.push(entry);
		search = '';
		status = '';
		family = section;
		select(entry.id);
		message = 'Nouveau terme ajouté au brouillon. Complète les champs puis enregistre.';
	}
	function remove() {
		if (active === undefined) return;
		removed.push({ ...active });
		entries = entries.filter((entry) => entry.id !== selected);
		select(entries[0]?.id ?? '');
		message = 'Terme retiré du brouillon. Tu peux annuler ce retrait, puis enregistrer.';
	}
	function undoRemoval() {
		const entry = removed.pop();
		if (entry === undefined) return;
		entries.push(entry);
		search = '';
		status = '';
		family = entry.section;
		select(entry.id);
		message = 'Terme restauré dans le brouillon.';
	}

	function download() {
		const url = URL.createObjectURL(
			new Blob([writeGlossary(base, entries)], { type: 'text/markdown' }),
		);
		const link = document.createElement('a');
		link.href = url;
		link.download = 'visual-language-brouillon.md';
		link.click();
		URL.revokeObjectURL(url);
	}
</script>

<svelte:head
	><title>Lexique visuel · Sequit</title><meta name="robots" content="noindex" /></svelte:head
>

<div class="lexicon">
	<header class="lex-header">
		<div>
			<a href={resolve('/atelier')}>← Atelier Sequit</a>
			<p class="eyebrow">LANGAGE PARTAGÉ · DOCUMENT DE TRAVAIL</p>
			<h1>Mettons les mots au clair.</h1>
			<p>Nommer, préciser, discuter. Puis valider ensemble.</p>
		</div>
		<div class="lex-actions">
			<span>{validated} / {entries.length} validés</span><button
				type="button"
				onclick={add}
				disabled={!loaded || busy}>Ajouter un terme</button
			><button type="button" onclick={download} disabled={!loaded}>Exporter le brouillon</button
			><button type="button" class="primary" onclick={save} disabled={!dirty || busy}
				>{#if busy}Enregistrement…{:else}Enregistrer les modifications{/if}</button
			>
		</div>
	</header>
	<div class="lex-notice" role="status">
		<span>{message}</span>{#if removed.length > 0}<button
				type="button"
				onclick={undoRemoval}
				disabled={busy}>Annuler le dernier retrait</button
			>{/if}{#if dirty}<strong>Modifications non enregistrées</strong>{/if}
	</div>
	<div class="lex-workspace">
		<aside class="lex-sidebar">
			<label
				>Rechercher<input
					type="search"
					bind:value={search}
					placeholder="Terme, traduction, remarque…"
				/></label
			>
			<label
				>Famille<select bind:value={family}
					><option value="">Toutes les familles</option>{#each families as item (item)}<option
							>{item}</option
						>{/each}</select
				></label
			>
			<label
				>Validation<select bind:value={status}
					><option value="">Tous les états</option>{#each GLOSSARY_STATUSES as item (item)}<option
							>{item}</option
						>{/each}</select
				></label
			>
			<p class="lex-count">{visible.length} termes · FR / EN</p>
			<nav aria-label="Termes du lexique">
				{#each visible as entry (entry.id)}<button
						type="button"
						class:chosen={selected === entry.id}
						onclick={() => {
							select(entry.id);
						}}
						><span class="term-top"
							><small>{entry.id}</small><small class:approved={entry.status === 'ok'}
								>{entry.status}</small
							></span
						><strong>{entry.fr}</strong><span>{entry.en}</span></button
					>{:else}<p>Aucun terme ne correspond aux filtres.</p>{/each}
			</nav>
		</aside>
		<main class="lex-editor">
			{#if active}
				<div class="entry-heading">
					<div>
						<p class="eyebrow">{active.section}</p>
						<h2>{active.fr}</h2>
					</div>
					<a
						href={`#${active.id}`}
						onclick={() => {
							select(active.id);
						}}>{active.id}</a
					>
				</div>
				<p class="lex-hint">
					Utilise cet identifiant pour discuter de ce terme. Les définitions restent des
					propositions jusqu’à validation.
				</p>
				<button type="button" onclick={remove} disabled={busy}>Retirer ce terme</button>
				<fieldset disabled={busy}>
					<label
						>Famille du terme<select aria-label="Famille du terme" bind:value={active.section}
							>{#each families as item (item)}<option>{item}</option>{/each}</select
						></label
					>
					<div class="lex-names">
						<label>Terme français<input bind:value={active.fr} /></label><label
							>English term<input lang="en" bind:value={active.en} /></label
						>
					</div>
					<label
						>Définition et frontières<textarea rows="6" bind:value={active.definition}
						></textarea></label
					>
					<label
						>Décision<select aria-label="Décision" bind:value={active.status}
							>{#each GLOSSARY_STATUSES as item (item)}<option>{item}</option>{/each}</select
						></label
					>
					<div class="lex-discussion">
						<h3>Remarques & discussion</h3>
						<p>
							Questions ouvertes, alternatives, exemples ou décision motivée. Tu peux signer et
							dater tes interventions.
						</p>
						<label
							>Notes de discussion<textarea
								rows="7"
								bind:value={active.notes}
								placeholder="Ex. : faut-il réserver « jonction » à l’opérateur logique ?"
							></textarea></label
						>
					</div>
				</fieldset>
				<footer>
					Enregistrement explicite dans le fichier Markdown du dépôt. Les autres sections du
					document sont conservées. Pour ajouter un terme ou revoir les exemples, le fichier reste
					éditable directement.
				</footer>
			{:else if loaded}<p>Sélectionne un terme dans la liste.</p>{/if}
		</main>
	</div>
</div>
