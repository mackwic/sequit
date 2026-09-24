import { afterEach, describe, expect, it, vi } from 'vitest';

import * as layout from '../../../../src/app/web/projection/layout-graph';
import { runRealK32Witness } from '../../../../src/app/workshop/solver-prototype/real-k32-witness';
import { LayoutDirection } from '../../../../src/lib/core/document/logic-document';
import { type LayoutResult, RoutingPortRole } from '../../../../src/lib/core/layout/layout-types';
import * as corridor from '../../../../src/lib/core/layout/routing/graph-corridor-conflicts';

const direction = LayoutDirection.TopToBottom;

function alterPipelineResult(alter: (result: LayoutResult) => LayoutResult): void {
	const realLayoutGraph = layout.layoutGraph;
	vi.spyOn(layout, 'layoutGraph').mockImplementation(async (...args) =>
		alter(await realLayoutGraph(...args)),
	);
}

afterEach(() => vi.restoreAllMocks());

describe('real K3,2 witness diagnostics', () => {
	it('keeps an unknown symbolic corridor unproven', async () => {
		vi.spyOn(corridor, 'graphCorridorConflicts').mockReturnValue({
			status: corridor.GraphCorridorStatus.Unknown,
			reason: corridor.GraphCorridorUnknownReason.OtherPassage,
		});
		const witness = await runRealK32Witness(direction);
		expect(witness.summary.conditionalConflicts).toBeUndefined();
		expect(witness.summary.assessment).toBe('unproven');
		expect(witness.summary.diagnostics).toContain(
			'Le corridor symbolique reste inconnu : other-passage.',
		);
	});

	it('withholds confirmation when an inverted corridor lacks an allocation', async () => {
		alterPipelineResult((result) => {
			const inspection = result.routingInspection;
			if (inspection === undefined) throw new Error('The real pipeline did not expose routing');
			expect(inspection.corridors.some(({ rank, allocated }) => rank === 0 && allocated)).toBe(
				true,
			);
			return {
				...result,
				routingInspection: {
					...inspection,
					corridors: inspection.corridors.map((corridor) => ({ ...corridor, allocated: false })),
				},
			};
		});
		const witness = await runRealK32Witness(direction);
		expect(witness.summary.conditionalConflicts?.inversions.length).toBeGreaterThan(0);
		expect(witness.summary.assessment).toBe('unproven');
		expect(witness.summary.diagnostics).toContain(
			'Aucun corridor adjacent alloué malgré les inversions.',
		);
	});

	it('withholds confirmation when a predicted inversion has no observed route crossing', async () => {
		alterPipelineResult((result) => ({ ...result, relations: [] }));
		const witness = await runRealK32Witness(direction);
		expect(witness.summary.conditionalConflicts?.inversions.length).toBeGreaterThan(0);
		expect(witness.summary.crossings).toEqual([]);
		expect(witness.summary.assessment).toBe('unproven');
		expect(witness.summary.diagnostics).toContain('Inversion non observée : a-to-e, b-to-d.');
	});

	it('sorts repeated crossing observations for the same relation pair by position', async () => {
		alterPipelineResult((result) => ({
			...result,
			relations: [
				{
					id: 'a-to-d',
					from: 'a',
					to: 'd',
					points: [
						{ x: 0, y: 10 },
						{ x: 100, y: 10 },
						{ x: 100, y: 20 },
						{ x: 0, y: 20 },
					],
				},
				{
					id: 'b-to-d',
					from: 'b',
					to: 'd',
					points: [
						{ x: 50, y: 0 },
						{ x: 50, y: 30 },
					],
				},
			],
		}));
		const witness = await runRealK32Witness(direction);
		expect(witness.summary.crossings).toEqual([
			{ firstRelationId: 'a-to-d', secondRelationId: 'b-to-d', point: { x: 50, y: 10 } },
			{ firstRelationId: 'a-to-d', secondRelationId: 'b-to-d', point: { x: 50, y: 20 } },
		]);
	});

	it('withholds confirmation when conflicting relations share an inspected incoming port', async () => {
		alterPipelineResult((result) => {
			const inspection = result.routingInspection;
			if (inspection === undefined) throw new Error('The real pipeline did not expose routing');
			return {
				...result,
				routingInspection: {
					...inspection,
					nodes: inspection.nodes.map((node) => {
						if (node.id !== 'd') return node;
						return {
							...node,
							ports: node.ports.map((port) => {
								if (port.role !== RoutingPortRole.Incoming) return port;
								return { ...port, relations: ['a-to-d', 'b-to-d'] };
							}),
						};
					}),
				},
			};
		});
		const witness = await runRealK32Witness(direction);
		expect(witness.summary.conditionalConflicts?.requiredSeparations.length).toBeGreaterThan(0);
		expect(witness.summary.assessment).toBe('unproven');
		expect(witness.summary.diagnostics).toContain('Port partagé malgré conflit : a-to-d, b-to-d.');
	});
});
