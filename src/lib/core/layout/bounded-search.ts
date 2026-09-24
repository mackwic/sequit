/** One alternative's typed outcome: always an evaluation, and a selection when the alternative is accepted. */
export interface BoundedSearchAttempt<Evaluation, Selection> {
	readonly evaluation: Evaluation;
	readonly selection?: Selection;
}

/** A bounded search reports whether its listed attempts exhaust the declared alternatives. */
export interface BoundedSearchWitness<Rejection> {
	readonly attempted: number;
	readonly exhaustive: boolean;
	readonly rejectedAlternatives: readonly Rejection[];
}

export interface BoundedSearchInput<Alternative, Evaluation, Selection> {
	readonly alternatives: readonly Alternative[];
	readonly budget: number;
	readonly evaluate: (alternative: Alternative) => BoundedSearchAttempt<Evaluation, Selection>;
	readonly better: (candidate: Selection, incumbent: Selection) => boolean;
}

export interface BoundedSearchResult<Evaluation, Selection> {
	readonly evaluations: readonly Evaluation[];
	readonly explored: number;
	readonly total: number;
	readonly exhaustive: boolean;
	readonly incumbent?: Selection;
}

/** Rejects a search budget that is not a non-negative safe integer. */
export function validatedSearchBudget(budget: number): number {
	if (!Number.isSafeInteger(budget) || budget < 0)
		throw new Error('Layout contract budget must be a non-negative safe integer');
	return budget;
}

/**
 * `best(objective)` + `bounded(budget)`: evaluates the declared prefix in list order and keeps
 * the `better` maximum of the accepted selections. The prefix is the given order sliced to the
 * budget, so ties keep the earliest incumbent; the result reports the attempts it exhausted.
 */
export function bestWithinBudget<Alternative, Evaluation, Selection>(
	input: BoundedSearchInput<Alternative, Evaluation, Selection>,
): BoundedSearchResult<Evaluation, Selection> {
	const { alternatives, budget, evaluate, better } = input;
	const evaluations: Evaluation[] = [];
	let incumbent: Selection | undefined;
	for (const alternative of alternatives.slice(0, budget)) {
		const attempt = evaluate(alternative);
		evaluations.push(attempt.evaluation);
		if (attempt.selection === undefined) continue;
		if (incumbent === undefined || better(attempt.selection, incumbent))
			incumbent = attempt.selection;
	}
	const result: BoundedSearchResult<Evaluation, Selection> = {
		evaluations,
		explored: evaluations.length,
		total: alternatives.length,
		exhaustive: alternatives.length <= budget,
	};
	if (incumbent === undefined) return result;
	return { ...result, incumbent };
}
