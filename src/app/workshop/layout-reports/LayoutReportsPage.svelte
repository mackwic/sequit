<script lang="ts">
	import { onMount } from 'svelte';

	import { resolve } from '$app/paths';

	import {
		LayoutReportCategory,
		type ReportedLayout,
	} from '../../../lib/infrastructure/layout-report/layout-report';
	import { parsePulledFiles, type PulledLayoutReport } from './pulled-layout-report';
	import { type LayoutReplay, LayoutReplayKind, replayLayoutReport } from './replay-layout-report';
	import type { ReportLayers } from './report-layers';
	import ReportCanvas from './ReportCanvas.svelte';

	const CATEGORY_LABELS: Readonly<Record<LayoutReportCategory, string>> = {
		[LayoutReportCategory.Overlap]: 'Chevauchement',
		[LayoutReportCategory.Crossing]: 'Croisement évitable',
		[LayoutReportCategory.Route]: 'Route étrange',
		[LayoutReportCategory.Spacing]: 'Espacement',
		[LayoutReportCategory.Order]: 'Ordre des éléments',
		[LayoutReportCategory.Failure]: 'Mise en page impossible',
		[LayoutReportCategory.Other]: 'Autre',
	};
	const dateFormat = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });

	let reports = $state.raw<readonly PulledLayoutReport[]>([]);
	let unreadable = $state.raw<readonly string[]>([]);
	let message = $state('Chargement des signalements…');
	let selectedId = $state('');
	const layers = $state<ReportLayers>({
		layout: true,
		rendered: false,
		replayed: false,
		zones: true,
	});
	let selected = $derived(reports.find(({ id }) => id === selectedId) ?? reports[0]);
	let replay = $derived(selected && replayLayoutReport(selected.report));

	onMount(() => {
		void load();
	});

	async function load(): Promise<void> {
		try {
			const response = await fetch('/atelier/reports/data');
			const pulled = parsePulledFiles(await response.json());
			if (!response.ok || pulled === undefined) throw new Error('Lecture impossible.');
			reports = pulled.reports;
			unreadable = pulled.unreadable;
			selectedId = window.location.hash.slice(1);
			message = '';
			if (reports.length === 0 && unreadable.length === 0)
				message = 'Aucun signalement local. Lance `pnpm reports:pull`, puis recharge la page.';
		} catch {
			message = 'Impossible de lire `layout-reports/`. Recharge la page.';
		}
	}

	function select(id: string): void {
		selectedId = id;
		window.history.replaceState(null, '', `#${id}`);
	}

	function version(report: PulledLayoutReport): string {
		if (report.build === undefined) return 'hors déploiement';
		if (report.build.tag !== '') return report.build.tag;
		return report.build.id.slice(0, 8);
	}

	function replayedGeometry(replay: LayoutReplay | undefined): ReportedLayout | undefined {
		if (replay?.kind !== LayoutReplayKind.Laid) return undefined;
		return replay.layout;
	}
</script>

<div class="reports-page">
	<header>
		<a href={resolve('/atelier')}>← Atelier Sequit</a>
		<span>SIGNALEMENTS DE LAYOUT · {reports.length}</span>
	</header>
	{#if message}<p class="notice">{message}</p>{/if}
	{#if unreadable.length > 0}
		<p class="notice" data-unreadable-reports>
			Illisibles par cette version : {unreadable.join(', ')}
		</p>
	{/if}
	<div class="layout">
		<nav aria-label="Signalements">
			{#each reports as report (report.id)}
				<button
					type="button"
					class:active={report === selected}
					aria-current={report === selected}
					data-report-id={report.id}
					onclick={() => {
						select(report.id);
					}}
				>
					<strong>{CATEGORY_LABELS[report.report.category]}</strong>
					<small>{dateFormat.format(new Date(report.receivedAt))} · {version(report)}</small>
					<span>{report.report.comment || 'Sans commentaire'}</span>
				</button>
			{/each}
		</nav>
		{#if selected}
			{@const report = selected.report}
			<article data-report={selected.id}>
				<h1>{CATEGORY_LABELS[report.category]}</h1>
				<blockquote>{report.comment || 'Sans commentaire'}</blockquote>
				{#await replay}
					<p class="verdict">Rejeu avec le moteur actuel…</p>
				{:then result}
					{#if result?.kind === LayoutReplayKind.Laid}
						<p class="verdict" class:different={!result.reproduced} data-replay={result.reproduced}>
							{#if result.reproduced}
								Le moteur actuel redonne exactement le layout signalé.
							{:else if report.layout}
								Le moteur actuel donne une autre géométrie que celle signalée.
							{:else}
								Le moteur actuel réussit là où le signalement montrait un échec.
							{/if}
						</p>
					{:else if result?.kind === LayoutReplayKind.Failed}
						<p class="verdict" class:different={!result.reproduced} data-replay={result.reproduced}>
							Le moteur actuel échoue : <code>{result.failure}</code>.
						</p>
					{:else}
						<p class="verdict different" data-replay="false">
							Cette version ne relit pas le document signalé.
						</p>
					{/if}
					<fieldset>
						<legend>Calques</legend>
						<label><input type="checkbox" bind:checked={layers.layout} /> Layout signalé</label>
						<label
							><input type="checkbox" bind:checked={layers.rendered} disabled={!report.rendered} />
							<span class="swatch rendered"></span> Dessiné à l’écran</label
						>
						<label
							><input
								type="checkbox"
								bind:checked={layers.replayed}
								disabled={result?.kind !== LayoutReplayKind.Laid}
							/>
							<span class="swatch replayed"></span> Rejoué ici</label
						>
						<label
							><input type="checkbox" bind:checked={layers.zones} />
							<span class="swatch zone"></span> Zones pointées</label
						>
					</fieldset>
					<ReportCanvas
						layout={report.layout}
						rendered={report.rendered}
						replayed={replayedGeometry(result)}
						zones={report.zones}
						{layers}
					/>
				{/await}
				{#if report.zones.length > 0}
					<ol class="zones">
						{#each report.zones as zone, index (index)}
							<li>
								{#each zone.entities as entity (`${entity.kind}:${entity.id}`)}
									<code>{entity.kind} {entity.id}</code>
								{:else}
									<em>aucun élément</em>
								{/each}
							</li>
						{/each}
					</ol>
				{/if}
				<dl>
					<dt>Reçu</dt>
					<dd>{dateFormat.format(new Date(selected.receivedAt))}</dd>
					<dt>Version</dt>
					<dd>{version(selected)}</dd>
					<dt>Échec affiché</dt>
					<dd>{report.failure ?? 'aucun'}</dd>
					<dt>Anonymisation</dt>
					<dd>
						{#if report.checks.anonymizationDiverged}a changé le layout{:else}sans effet{/if}
					</dd>
					<dt>Projection affichée</dt>
					<dd>
						{#if report.checks.projectionDiverged}différente du layout à froid{:else}identique{/if}
					</dd>
					<dt>Fenêtre</dt>
					<dd>
						{report.environment.viewport.width} × {report.environment.viewport.height} ·
						{report.environment.devicePixelRatio}x · {report.environment.language}
						{#if report.rendered}· zoom {Math.round(report.rendered.zoom * 100)} %{/if}
					</dd>
					<dt>Navigateur</dt>
					<dd>{report.environment.userAgent}</dd>
					<dt>Fichier</dt>
					<dd><code>{selected.id}</code></dd>
				</dl>
				<details>
					<summary>Document anonymisé (TOML)</summary>
					<pre>{report.document}</pre>
				</details>
			</article>
		{/if}
	</div>
</div>

<style>
	:global(body:has(.reports-page)) {
		background: #f6f5f0;
	}
	.reports-page {
		max-width: 1600px;
		margin: auto;
		padding: 2rem 2rem 4rem;
		color: #243e32;
		font-family: system-ui, sans-serif;
	}
	header {
		display: flex;
		justify-content: space-between;
		padding-bottom: 1rem;
		border-bottom: 1px solid #d8ded2;
	}
	header a {
		color: #416f58;
	}
	header span {
		font-size: 0.7rem;
		font-weight: 650;
		letter-spacing: 0.14em;
		color: #687a6c;
	}
	.notice {
		color: #687a6c;
	}
	.layout {
		display: grid;
		grid-template-columns: 300px minmax(0, 1fr);
		gap: 1.5rem;
		margin-top: 1.5rem;
	}
	nav {
		display: grid;
		align-content: start;
		gap: 6px;
	}
	nav button {
		display: grid;
		gap: 2px;
		padding: 10px 12px;
		text-align: left;
		background: #fff;
		border: 1px solid #d8ded2;
		border-radius: 8px;
		cursor: pointer;
	}
	nav button.active {
		border-color: #416f58;
		box-shadow: inset 3px 0 0 #416f58;
	}
	nav small {
		color: #687a6c;
	}
	nav span {
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
		font-size: 13px;
	}
	article {
		display: grid;
		gap: 1rem;
		align-content: start;
	}
	h1 {
		margin: 0;
		font-size: 1.4rem;
	}
	blockquote {
		margin: 0;
		padding: 0.5rem 1rem;
		background: #fff;
		border-left: 3px solid #416f58;
		white-space: pre-wrap;
	}
	.verdict {
		margin: 0;
		padding: 0.5rem 0.75rem;
		border-radius: 6px;
		background: #edf8f1;
		color: #216543;
	}
	.verdict.different {
		background: #fff0f2;
		color: #b42336;
	}
	fieldset {
		display: flex;
		flex-wrap: wrap;
		gap: 1rem;
		border: 0;
		padding: 0;
		margin: 0;
	}
	legend {
		float: left;
		font-weight: 600;
	}
	.swatch {
		display: inline-block;
		width: 14px;
		height: 3px;
		vertical-align: middle;
	}
	.swatch.rendered {
		background: #c2410c;
	}
	.swatch.replayed {
		background: #175cd3;
	}
	.swatch.zone {
		background: #b42318;
	}
	.zones {
		margin: 0;
		padding-left: 1.5rem;
		list-style: decimal;
		display: grid;
		gap: 4px;
	}
	.zones code {
		margin-right: 6px;
	}
	dl {
		display: grid;
		grid-template-columns: max-content minmax(0, 1fr);
		gap: 4px 1rem;
		margin: 0;
		font-size: 13px;
	}
	dt {
		color: #687a6c;
	}
	dd {
		margin: 0;
		overflow-wrap: anywhere;
	}
	pre {
		max-height: 400px;
		overflow: auto;
		padding: 0.75rem;
		background: #fff;
		font-size: 12px;
	}
</style>
