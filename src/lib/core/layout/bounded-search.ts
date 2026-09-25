/** One alternative's typed outcome: always an evaluation, and a selection when the alternative is accepted. */
interface BoundedSearchAttempt<Evaluation, Selection> {
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

export interface StreamBestSearchInput<Alternative, Selection> {
	readonly alternatives: Iterable<Alternative>;
	readonly budget: number;
	/** Exact decimal cardinality, allowing products larger than Number.MAX_SAFE_INTEGER. */
	readonly total: string;
	readonly evaluate: (alternative: Alternative) => Selection | undefined;
	readonly better: (candidate: Selection, incumbent: Selection) => boolean;
}

export interface StreamBestSearchResult<Selection> {
	readonly attempted: number;
	readonly total: string;
	readonly exhaustive: boolean;
	readonly truncated: boolean;
	readonly incumbent?: Selection;
}

/** Scores a lazy prefix without allocating the candidate product or its evaluation list. */
export function bestWithinBudgetStream<Alternative, Selection>(
	input: StreamBestSearchInput<Alternative, Selection>,
): StreamBestSearchResult<Selection> {
	const counter = boundedCounter(validatedSearchBudget(input.budget));
	let incumbent: Selection | undefined;
	let exhaustive = true;
	for (const alternative of input.alternatives) {
		if (!counter.take()) {
			exhaustive = false;
			break;
		}
		const candidate = input.evaluate(alternative);
		if (candidate !== undefined) {
			if (incumbent === undefined || input.better(candidate, incumbent)) incumbent = candidate;
		}
	}
	const result: StreamBestSearchResult<Selection> = {
		attempted: counter.attempted,
		total: input.total,
		exhaustive,
		truncated: !exhaustive,
	};
	if (incumbent === undefined) return result;
	return { ...result, incumbent };
}

/** One bounded counter's evidence: the alternatives it spent and whether it refused one. */
export interface SearchBudgetEvidence {
	attempted: number;
	exhausted: boolean;
}

/** A bounded counter reserves one alternative per examined choice until it refuses. */
export interface SearchBudgetCounter {
	take(): boolean;
	readonly attempted: number;
	readonly exhausted: boolean;
}

/**
 * A counter bounded by `limit` alternatives. It keeps its own evidence unless the caller passes
 * evidence of its own, which is how a search keeps its own witness fields as the count.
 */
export function boundedCounter(
	limit: number,
	evidence: SearchBudgetEvidence = { attempted: 0, exhausted: false },
): SearchBudgetCounter {
	const counter: SearchBudgetCounter = {
		take(): boolean {
			if (evidence.attempted >= limit) {
				evidence.exhausted = true;
				return false;
			}
			evidence.attempted += 1;
			return true;
		},
		get attempted(): number {
			return evidence.attempted;
		},
		get exhausted(): boolean {
			return evidence.exhausted;
		},
	};
	return counter;
}

/**
 * A counter capped at `limit` for one phase of a wider search: it refuses at its own cap and
 * otherwise consumes its parent, so no phase overspends the global budget. A phase restarts by
 * resetting the evidence it owns.
 */
export function scopedCounter(
	parent: SearchBudgetCounter,
	limit: number,
	evidence: SearchBudgetEvidence = { attempted: 0, exhausted: false },
): SearchBudgetCounter {
	const counter: SearchBudgetCounter = {
		take(): boolean {
			if (evidence.attempted >= limit) {
				evidence.exhausted = true;
				return false;
			}
			if (!parent.take()) return false;
			evidence.attempted += 1;
			return true;
		},
		get attempted(): number {
			return evidence.attempted;
		},
		get exhausted(): boolean {
			return evidence.exhausted;
		},
	};
	return counter;
}

export interface FirstValidSearchInput<Choice, Rejection> {
	readonly levels: number;
	readonly counter: SearchBudgetCounter;
	readonly choices: (level: number, prefix: readonly Choice[]) => Iterable<Choice>;
	readonly accept: (
		level: number,
		choice: Choice,
		prefix: readonly Choice[],
	) => Rejection | undefined;
	readonly onReject: (level: number, choice: Choice, rejection: Rejection) => void;
	readonly onBacktrack?: ((level: number, choice: Choice) => void) | undefined;
	readonly onExhausted?: ((level: number, prefix: readonly Choice[]) => void) | undefined;
}

export interface FirstValidSearchResult<Choice> {
	readonly selected?: readonly Choice[];
	readonly exhaustive: boolean;
}

/**
 * `firstValid` + `bounded(budget)`: a depth-first search whose acceptance depends on the selected
 * prefix. Levels are walked in the iteration order of `choices`, and every examined choice reserves
 * one alternative before its acceptance is evaluated, so a refused reservation stops the search
 * non-exhaustively. A level whose choices are all rejected reports it to `onExhausted`, and a choice
 * whose fully explored subtree failed reports it to `onBacktrack`.
 */
export function firstValidDepthFirst<Choice, Rejection>(
	input: FirstValidSearchInput<Choice, Rejection>,
): FirstValidSearchResult<Choice> {
	const { levels, counter, choices, accept, onReject, onBacktrack, onExhausted } = input;
	const selected: Choice[] = [];
	let stopped = false;

	function descend(level: number): boolean {
		if (level === levels) return true;
		for (const choice of choices(level, selected)) {
			if (!counter.take()) {
				stopped = true;
				return false;
			}
			const rejection = accept(level, choice, selected);
			if (rejection !== undefined) {
				onReject(level, choice, rejection);
				continue;
			}
			selected.push(choice);
			const found = descend(level + 1);
			if (found) return true;
			selected.pop();
			if (stopped) return false;
			onBacktrack?.(level, choice);
		}
		onExhausted?.(level, selected);
		return false;
	}

	const found = descend(0);
	if (!found) return { exhaustive: !stopped };
	return { selected: [...selected], exhaustive: !stopped };
}
