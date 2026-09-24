import { describe, expect, it } from 'vitest';

import { solveJointK32Contract } from '../../../../src/app/workshop/solver-prototype/joint-k32-contract';
import {
	completeJointK32Fixture,
	sparseJointCorridorFixture,
} from '../../../../src/app/workshop/solver-prototype/joint-k32-fixtures';

describe('joint corridor and face contract', () => {
	it('derives two three-port target faces under either complete K3,2 row order', () => {
		const result = solveJointK32Contract(completeJointK32Fixture());
		expect(result.searchStatus).toBe('complete');
		expect(result.globalStatus).toBe('undetermined');
		expect(result.branches).toHaveLength(72);
		for (const analysis of result.analyses.filter(({ status }) => status === 'deduced')) {
			expect(analysis.conflicts.inversions).toHaveLength(3);
			expect(analysis.conflicts.requiredSeparations).toHaveLength(6);
			for (const face of analysis.faces) {
				const allowed = face.alternatives.filter(
					({ respectsRequiredSeparations }) => respectsRequiredSeparations,
				);
				expect(allowed).toHaveLength(1);
				expect(allowed[0]?.portGroups).toHaveLength(3);
				expect(allowed[0]?.minimumCrossSize).toBe(144);
				expect(allowed[0]?.physicalOrders).toHaveLength(6);
			}
		}
		expect(result.branches.every(({ faces }) => faces.length === 2)).toBe(true);
		expect(result.branches.every(({ totalGrowth }) => totalGrowth === 128)).toBe(true);
		expect(result.incumbent?.forcedOrderInversionCount).toBe(3);
		expect(result.trace.filter(({ kind }) => kind === 'face-partition-rejected')).toHaveLength(16);
	});

	it('recomputes conflicts and face demand when only target order changes on the sparse graph', () => {
		const result = solveJointK32Contract(sparseJointCorridorFixture());
		const crossed = result.analyses.find(({ candidate }) => candidate.id === 'adjacent-d-before-e');
		const shared = result.analyses.find(({ candidate }) => candidate.id === 'adjacent-e-before-d');
		expect(crossed?.conflicts.inversions).toHaveLength(2);
		expect(crossed?.conflicts.requiredSeparations).toHaveLength(3);
		expect(shared?.conflicts.inversions).toHaveLength(0);
		expect(shared?.conflicts.requiredSeparations).toHaveLength(0);
		const crossedD = crossed?.faces.find(({ endpointId }) => endpointId === 'd');
		const sharedD = shared?.faces.find(({ endpointId }) => endpointId === 'd');
		expect(
			crossedD?.alternatives.filter(
				({ respectsRequiredSeparations }) => respectsRequiredSeparations,
			),
		).toHaveLength(1);
		expect(crossedD?.alternatives[4]?.minimumCrossSize).toBe(144);
		expect(sharedD?.alternatives.map(({ minimumCrossSize }) => minimumCrossSize)).toEqual([
			80, 96, 96, 96, 144,
		]);
		expect(sharedD?.alternatives[0]?.portGroups).toHaveLength(1);
		expect(result.incumbent?.candidateId).toBe('adjacent-e-before-d');
		expect(
			result.incumbent?.faces.find(({ endpointId }) => endpointId === 'd')?.minimumCrossSize,
		).toBe(80);
		expect(result.incumbent?.totalGrowth).toBe(0);
		expect(result.trace.filter(({ kind }) => kind === 'incumbent')).toHaveLength(2);
	});

	it('keeps other passages unknown and makes no global infeasibility claim', () => {
		const fixture = completeJointK32Fixture();
		const onlyOutside = {
			...fixture,
			candidates: fixture.candidates.filter(({ id }) => id === 'outside-corridor'),
		};
		const result = solveJointK32Contract(onlyOutside);
		expect(result.analyses[0]?.status).toBe('unknown');
		expect(result.analyses[0]?.conflicts.reason).toBe('other-passage');
		expect(result.branches).toEqual([]);
		expect(result.incumbent).toBeUndefined();
		expect(result.searchStatus).toBe('complete');
		expect(result.globalStatus).toBe('undetermined');
		expect(result.trace).toEqual([
			{ candidateId: 'outside-corridor', kind: 'unknown-passage', detail: 'other-passage' },
		]);
	});

	it('reserves both insets even on the sparse target with one incidence', () => {
		const fixture = sparseJointCorridorFixture();
		const result = solveJointK32Contract({
			...fixture,
			faceMetrics: fixture.faceMetrics.map((metrics) => {
				if (metrics.endpointId === 'e') return { ...metrics, intrinsicCrossSize: 20 };
				return metrics;
			}),
		});
		for (const analysis of result.analyses.filter(({ status }) => status === 'deduced')) {
			const singleton = analysis.faces.find(({ endpointId }) => endpointId === 'e');
			expect(singleton?.alternatives).toHaveLength(1);
			expect(singleton?.alternatives[0]?.minimumCrossSize).toBe(48);
			expect(singleton?.alternatives[0]?.growth).toBe(28);
		}
		expect(result.incumbent?.totalGrowth).toBe(28);
	});

	it('retains an incumbent but reports incomplete search when the branch budget ends', () => {
		const fixture = sparseJointCorridorFixture();
		const full = solveJointK32Contract(fixture);
		const limited = solveJointK32Contract(fixture, { maxBranches: 1 });
		expect(full.searchStatus).toBe('complete');
		expect(full.incumbent?.candidateId).toBe('adjacent-e-before-d');
		expect(limited.exploredBranches).toBe(1);
		expect(limited.searchStatus).toBe('incomplete');
		expect(limited.incumbent?.candidateId).toBe('adjacent-d-before-e');
		expect(limited.branches.some(({ status }) => status === 'not-explored')).toBe(true);
		expect(limited.trace.at(-1)?.kind).toBe('budget-exhausted');
		expect(limited.globalStatus).toBe('undetermined');
		const none = solveJointK32Contract(fixture, { maxBranches: 0 });
		expect(none.incumbent).toBeUndefined();
		expect(none.searchStatus).toBe('incomplete');
	});

	it('normalizes collections without erasing candidate row-order decisions', () => {
		for (const fixture of [completeJointK32Fixture(), sparseJointCorridorFixture()]) {
			const original = solveJointK32Contract(fixture, { maxBranches: 8 });
			const permuted = solveJointK32Contract(
				{
					...fixture,
					sourceIds: fixture.sourceIds.toReversed(),
					targetIds: fixture.targetIds.toReversed(),
					relations: fixture.relations.toReversed(),
					faceMetrics: fixture.faceMetrics.toReversed(),
					candidates: fixture.candidates.toReversed(),
				},
				{ maxBranches: 8 },
			);
			expect(permuted).toEqual(original);
		}
	});

	it('rejects malformed graph identity, face metrics, orders and budgets', () => {
		const fixture = sparseJointCorridorFixture();
		const firstFace = fixture.faceMetrics[0];
		const secondFace = fixture.faceMetrics[1];
		const firstCandidate = fixture.candidates[0];
		if (firstFace === undefined || secondFace === undefined || firstCandidate === undefined)
			throw new Error('Incomplete joint fixture.');
		expect(() =>
			solveJointK32Contract({
				...fixture,
				relations: [...fixture.relations, fixture.relations[0]].filter(
					(relation) => relation !== undefined,
				),
			}),
		).toThrow(/four or six/);
		expect(() =>
			solveJointK32Contract({
				...fixture,
				faceMetrics: [{ ...firstFace, intrinsicCrossSize: Number.NaN }, secondFace],
			}),
		).toThrow(/face metrics/);
		expect(() =>
			solveJointK32Contract({
				...fixture,
				candidates: [{ ...firstCandidate, sourceOrder: ['a', 'b', 'b'] }],
			}),
		).toThrow(/order each/);
		expect(() => solveJointK32Contract(fixture, { maxBranches: -1 })).toThrow(/budget/);
		expect(() => solveJointK32Contract(fixture, { maxBranches: 0.5 })).toThrow(/budget/);
	});

	it('rejects contradictory endpoint and incidence identities before exploring branches', () => {
		const fixture = sparseJointCorridorFixture();
		const firstCandidate = fixture.candidates[0];
		if (firstCandidate === undefined) throw new Error('Incomplete joint fixture.');
		expect(() => solveJointK32Contract({ ...fixture, sourceIds: ['a', 'a', 'c'] })).toThrow(
			/distinct sources/,
		);
		expect(() => solveJointK32Contract({ ...fixture, targetIds: ['d', 'd'] })).toThrow(
			/distinct targets/,
		);
		expect(() => solveJointK32Contract({ ...fixture, targetIds: ['a', 'e'] })).toThrow(
			/source and target IDs must be distinct/,
		);
		expect(() =>
			solveJointK32Contract({
				...fixture,
				relations: fixture.relations.map((relation) => {
					if (relation.id === 'b-d') return { ...relation, from: 'outside' };
					return relation;
				}),
			}),
		).toThrow(/outside K3,2/);
		expect(() =>
			solveJointK32Contract({
				...fixture,
				relations: fixture.relations.map((relation) => {
					if (relation.id === 'b-d') return { ...relation, from: 'a' };
					return relation;
				}),
			}),
		).toThrow(/repeat a source-target pair/);
		expect(() =>
			solveJointK32Contract({
				...fixture,
				relations: [
					{ id: 'a-d', from: 'a', to: 'd' },
					{ id: 'b-d', from: 'b', to: 'd' },
					{ id: 'a-e', from: 'a', to: 'e' },
					{ id: 'c-e', from: 'c', to: 'e' },
				],
			}),
		).toThrow(/target indegrees/);
		expect(() =>
			solveJointK32Contract({ ...fixture, faceMetrics: fixture.faceMetrics.slice(0, 1) }),
		).toThrow(/one face metric set per target/);
		expect(() =>
			solveJointK32Contract({
				...fixture,
				candidates: [...fixture.candidates, firstCandidate],
			}),
		).toThrow(/candidate IDs must be unique/);
		expect(() =>
			solveJointK32Contract({
				...fixture,
				candidates: [{ ...firstCandidate, targetOrder: ['e', 'e'] }],
			}),
		).toThrow(/order each/);
	});
});
