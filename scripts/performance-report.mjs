/** Validate both files before comparing: missing cases must never look like improvements. */
export function validateReport(report) {
	if (report?.version !== 1 || report.complete !== true)
		throw new Error('Rapport incomplet ou version non prise en charge.');
	if (!report.context || !report.source || !Array.isArray(report.measurements))
		throw new Error('Contexte ou mesures manquants.');
	if (report.measurements.length === 0) throw new Error('Aucune mesure.');
	const keys = new Set();
	for (const row of report.measurements) {
		const key = measurementKey(row);
		if (keys.has(key)) throw new Error(`Mesure dupliquée : ${key}`);
		keys.add(key);
		if (
			typeof row.scenario !== 'string' ||
			!row.scenario ||
			!['medianMs', 'totalP95Ms'].includes(row.metric)
		)
			throw new Error('Identité de mesure invalide.');
		if (
			!Number.isFinite(row.observedMs) ||
			row.observedMs < 0 ||
			!Number.isFinite(row.budgetMs) ||
			row.budgetMs <= 0
		)
			throw new Error(`Durée ou budget invalide : ${key}`);
	}
}

function measurementKey(row) {
	return JSON.stringify([row.scenario, row.size, row.metric]);
}

function status(before, after) {
	const failedBefore = before.observedMs >= before.budgetMs;
	const failedAfter = after.observedMs >= after.budgetMs;
	if (failedBefore && failedAfter) return 'Dépassement déjà présent';
	if (failedAfter) return 'Nouveau dépassement';
	if (failedBefore) return 'Retour dans le budget';
	return 'Dans le budget';
}

/** @returns {Array<{scenario:string,size:number|string,metric:string,beforeMs:number,afterMs:number,deltaMs:number,budgetMs:number,status:string}>} */
export function compareReports(before, after) {
	validateReport(before);
	validateReport(after);
	for (const key of ['suite', 'filter', 'machine', 'runtime', 'protocol']) {
		if (JSON.stringify(before.context[key]) !== JSON.stringify(after.context[key]))
			throw new Error(`Rapports incompatibles : ${key}.`);
		if (before.context[key] === undefined) throw new Error(`Contexte manquant : ${key}.`);
	}
	const old = new Map(before.measurements.map((row) => [measurementKey(row), row]));
	if (old.size !== after.measurements.length)
		throw new Error('Les rapports ne couvrent pas les mêmes cas.');
	return after.measurements.map((row) => {
		const previous = old.get(measurementKey(row));
		if (!previous) throw new Error(`Cas absent de la référence : ${measurementKey(row)}.`);
		if (previous.budgetMs !== row.budgetMs) throw new Error('Les budgets ont changé.');
		return {
			scenario: row.scenario,
			size: row.size,
			metric: row.metric,
			beforeMs: previous.observedMs,
			afterMs: row.observedMs,
			deltaMs: row.observedMs - previous.observedMs,
			budgetMs: row.budgetMs,
			status: status(previous, row),
		};
	});
}

export function formatComparison(rows) {
	const lines = [
		'| Scénario | Taille / tranche | Mesure | Avant (ms) | Après (ms) | Écart (ms) | Budget (ms) | Bilan |',
		'| --- | --- | --- | ---: | ---: | ---: | ---: | --- |',
	];
	for (const row of rows)
		lines.push(
			`| ${row.scenario} | ${row.size} | ${row.metric} | ${row.beforeMs.toFixed(3)} | ${row.afterMs.toFixed(3)} | ${row.deltaMs.toFixed(3)} | <${row.budgetMs} | ${row.status} |`,
		);
	return `${lines.join('\n')}\n`;
}
