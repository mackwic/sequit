import { afterEach, describe, expect, it, vi } from 'vitest';

import * as canvas from '../../../../src/app/web/ui/canvas/render-relations';
import { compareAdjacentBridgeAndDetour } from '../../../../src/app/workshop/solver-prototype/adjacent-engine-comparison';
import * as witness from '../../../../src/app/workshop/solver-prototype/real-k32-witness';
import * as independent from '../../../../src/lib/core/layout/contract/independent-adjacent-resolution';
import * as contract from '../../../../src/lib/core/layout/contract/layout-contract';
import * as corridor from '../../../../src/lib/core/layout/routing/graph-corridor-conflicts';

afterEach(() => vi.restoreAllMocks());

describe('adjacent bridge comparison diagnostics', () => {
	it('refuses a source document that cannot form a graph', async () => {
		const realFixture = witness.realK32Fixture;
		vi.spyOn(witness, 'realK32Fixture').mockImplementation((...args) => {
			const fixture = realFixture(...args);
			return {
				...fixture,
				document: {
					...fixture.document,
					relations: [...fixture.document.relations, { id: 'd-to-a', from: 'd', to: 'a' }],
				},
			};
		});
		await expect(compareAdjacentBridgeAndDetour()).rejects.toThrow(
			'The adjacent comparison document could not be created: Cycle detected: a -> d -> a',
		);
	});

	it('does not present an incomplete independent search as a selected detour', async () => {
		const realResolve = independent.resolveIndependentAdjacentContract;
		vi.spyOn(independent, 'resolveIndependentAdjacentContract').mockImplementation(
			(graph, ranks, measurements) => realResolve(graph, ranks, measurements, { maxBranches: 0 }),
		);
		await expect(compareAdjacentBridgeAndDetour()).rejects.toThrow(
			'Independent adjacent comparison is incomplete.',
		);
	});

	it('does not confirm a dedicated witness whose symbolic corridor is unresolved', async () => {
		const realCorridor = corridor.graphCorridorConflicts;
		vi.spyOn(corridor, 'graphCorridorConflicts')
			.mockReturnValueOnce({
				status: corridor.GraphCorridorStatus.Unknown,
				reason: corridor.GraphCorridorUnknownReason.OtherPassage,
			})
			.mockImplementation(realCorridor);
		await expect(compareAdjacentBridgeAndDetour()).rejects.toThrow(
			'Dedicated adjacent witness is unproven: Le corridor symbolique reste inconnu : other-passage.',
		);
	});

	it('rejects a dedicated result paired with different topological ranks', async () => {
		const realWitness = witness.runRealK32Witness;
		vi.spyOn(witness, 'runRealK32Witness').mockImplementation(async (...args) => {
			const observed = await realWitness(...args);
			return { ...observed, ranks: new Map([...observed.ranks, ['a', 9]]) };
		});
		await expect(compareAdjacentBridgeAndDetour()).rejects.toThrow(
			'Dedicated and independent adjacent ranks differ.',
		);
	});

	it('rejects a comparison if the previously built contract becomes unknown', async () => {
		const realBuild = contract.buildAdjacentLayoutContract;
		let buildCount = 0;
		vi.spyOn(contract, 'buildAdjacentLayoutContract').mockImplementation((...args) => {
			buildCount += 1;
			if (buildCount > 1)
				return {
					status: contract.LayoutContractBuildStatus.Unknown,
					reason: contract.LayoutContractUnknownReason.UnsupportedCorridor,
				};
			return realBuild(...args);
		});
		await expect(compareAdjacentBridgeAndDetour()).rejects.toThrow(
			'An adjacent comparison layout failed its geometric contract.',
		);
	});

	it('rejects a dedicated layout whose boxes violate the geometric contract', async () => {
		const realWitness = witness.runRealK32Witness;
		vi.spyOn(witness, 'runRealK32Witness').mockImplementation(async (...args) => {
			const observed = await realWitness(...args);
			return {
				...observed,
				layout: {
					...observed.layout,
					elements: observed.layout.elements.map((element) => {
						if (element.id === 'd') return { ...element, bounds: { ...element.bounds, x: -1 } };
						return element;
					}),
				},
			};
		});
		await expect(compareAdjacentBridgeAndDetour()).rejects.toThrow(
			'An adjacent comparison layout failed its geometric contract.',
		);
	});

	it('rejects an independent layout whose boxes violate the geometric contract', async () => {
		const realResolve = independent.resolveIndependentAdjacentContract;
		vi.spyOn(independent, 'resolveIndependentAdjacentContract').mockImplementation((...args) => {
			const resolved = realResolve(...args);
			if (resolved.status !== independent.IndependentAdjacentStatus.Selected) return resolved;
			return {
				...resolved,
				selection: {
					...resolved.selection,
					layout: {
						...resolved.selection.layout,
						elements: resolved.selection.layout.elements.map((element) => {
							if (element.id === 'e') return { ...element, bounds: { ...element.bounds, x: -1 } };
							return element;
						}),
					},
				},
			};
		});
		await expect(compareAdjacentBridgeAndDetour()).rejects.toThrow(
			'An adjacent comparison layout failed its geometric contract.',
		);
	});

	it('refuses a reported crossing that has no matching rendered bridge', async () => {
		const realRender = canvas.renderRelationPaths;
		vi.spyOn(canvas, 'renderRelationPaths').mockImplementation((routes) =>
			realRender(routes).map((relation) => ({
				...relation,
				path: relation.path.replaceAll(/\bA /g, 'L '),
			})),
		);
		await expect(compareAdjacentBridgeAndDetour()).rejects.toThrow(
			'The dedicated adjacent witness has no rendered bridge.',
		);
	});

	it('refuses a validated independent crossing whose bridge arc is not rendered', async () => {
		const realRender = canvas.renderRelationPaths;
		let renderedPanels = 0;
		vi.spyOn(canvas, 'renderRelationPaths').mockImplementation((routes) => {
			renderedPanels += 1;
			const rendered = realRender(routes);
			if (renderedPanels !== 2) return rendered;
			return rendered.map((relation) => ({
				...relation,
				path: relation.path.replaceAll(/\bA 6 6 /g, 'L '),
			}));
		});
		await expect(compareAdjacentBridgeAndDetour()).rejects.toThrow(
			'The independent adjacent bridge mark differs from the selected issue.',
		);
	});
});
