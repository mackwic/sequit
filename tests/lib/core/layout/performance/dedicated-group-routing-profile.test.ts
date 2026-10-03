import { performance } from 'node:perf_hooks';

import fc from 'fast-check';
import { expect, it } from 'vitest';

import {
	defined,
	LayoutBias,
	layoutConfiguration,
	LayoutDirection,
	type LogicDocument,
} from '../../../../../src/lib/core/document/logic-document';
import { validateDedicatedCandidate } from '../../../../../src/lib/core/layout/dedicated-candidate-validation/validate';
import { layoutWithDedicatedEngineAndRankOrderWitness } from '../../../../../src/lib/core/layout/layout-engine';
import { GroupRouteFailure } from '../../../../../src/lib/core/layout/layout-types';
import { richAcyclicLogicDocumentArbitrary } from '../../../../support/builders/logic-document-arbitrary';
import { prepareLayoutDocument } from '../../../../support/harnesses/layout';

const CENSUS_SEED = 1_592_915_777;
const CENSUS_DOCUMENTS = 300;

interface DirectionCensus {
	readonly direction: LayoutDirection;
	/** Documents whose group passages raise a typed failure. */
	readonly failures: number[];
	/** Rejected publications that the witness does not call unverified. */
	readonly rejected: number[];
	/** Rejected publications that the witness calls unverified. */
	readonly rejectedUnverified: number[];
	/** Valid publications that the witness calls unverified. */
	readonly validUnverified: number[];
	readonly durations: number[];
}

function censusDirection(
	documents: readonly LogicDocument[],
	direction: LayoutDirection,
): DirectionCensus {
	const census: DirectionCensus = {
		direction,
		failures: [],
		rejected: [],
		rejectedUnverified: [],
		validUnverified: [],
		durations: [],
	};
	for (const [index, document] of documents.entries()) {
		const prepared = prepareLayoutDocument({
			...document,
			layout: defined(
				layoutConfiguration(direction, LayoutBias.Top) ??
					layoutConfiguration(direction, LayoutBias.Left),
			),
		});
		const start = performance.now();
		try {
			const { layout, witness } = layoutWithDedicatedEngineAndRankOrderWitness(
				prepared.graph,
				prepared.ranks,
				prepared.measurements,
			);
			const { valid } = validateDedicatedCandidate({ ...prepared, layout });
			if (!valid && witness.unverified === 1) census.rejectedUnverified.push(index);
			else if (!valid) census.rejected.push(index);
			else if (witness.unverified === 1) census.validUnverified.push(index);
		} catch (error) {
			if (!(error instanceof GroupRouteFailure)) throw error;
			census.failures.push(index);
		}
		census.durations.push(performance.now() - start);
	}
	return census;
}

function summary(census: DirectionCensus): string {
	const total = census.durations.reduce((sum, duration) => sum + duration, 0);
	return [
		`${census.direction}: ${census.failures.length} GroupRouteFailure [${census.failures.join(', ')}]`,
		`rejected ${census.rejected.length}, rejected unverified ${census.rejectedUnverified.length}`,
		`valid unverified ${census.validUnverified.length} [${census.validUnverified.join(', ')}]`,
		`total ${(total / 1000).toFixed(1)} s, max ${(Math.max(...census.durations) / 1000).toFixed(2)} s`,
	].join('; ');
}

// Workshop census of the 2026-10-02 group passage repairs (refactoring journal): too slow for the
// property suite, which draws smaller documents in one direction each.
it('censuses group passages of generated documents in the four directions', () => {
	const documents = fc.sample(richAcyclicLogicDocumentArbitrary(), {
		seed: CENSUS_SEED,
		numRuns: CENSUS_DOCUMENTS,
	});
	const censuses = Object.values(LayoutDirection).map((direction) =>
		censusDirection(documents, direction),
	);
	process.stdout.write(
		`\nDedicated group passages, ${CENSUS_DOCUMENTS} documents, seed ${CENSUS_SEED}:\n${censuses.map(summary).join('\n')}\n`,
	);
	for (const census of censuses) {
		expect(census.failures, census.direction).toEqual([]);
		expect(census.rejected, census.direction).toEqual([]);
	}
}, 600_000);
