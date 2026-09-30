import { describe, expect, it } from 'vitest';

import {
	EndpointKind,
	JunctionOperator,
	LayoutBias,
	type LayoutConfiguration,
	LayoutDirection,
	type LogicDocument,
} from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import { validateDedicatedCandidate } from '../../../../src/lib/core/layout/dedicated-candidate-validation/validate';
import { layoutWithDedicatedEngine } from '../../../../src/lib/core/layout/layout-engine';
import type { GroupMeasurement, Size } from '../../../../src/lib/core/layout/layout-types';
import { validLogicDocument } from '../../../support/builders/logic-document';
import { prepareLayoutDocument } from '../../../support/harnesses/layout';

interface Witness {
	readonly layout: LayoutConfiguration;
	/** Node id, size and optional group. */
	readonly nodes: readonly (readonly [string, Size, string?])[];
	readonly junctions?: readonly (readonly [string, string?])[];
	/** Group id, measurement and optional parent group. */
	readonly groups: readonly (readonly [string, GroupMeasurement, string?])[];
	readonly relations: readonly (readonly [string, string])[];
}

function measurement(
	minimumWidth: number,
	minimumHeight: number,
	headerHeight: number,
	padding: number,
): GroupMeasurement {
	return { minimumWidth, minimumHeight, headerHeight, padding };
}

function inGroup(groupId: string | undefined): { groupId?: string } {
	if (groupId === undefined) return {};
	return { groupId };
}

function layoutWitness(witness: Witness) {
	const base = validLogicDocument();
	let order = 0;
	const nextKey = () => orderKey(`a${order++}`);
	const document: LogicDocument = {
		...base,
		layout: witness.layout,
		groups: witness.groups.map(([id, , parent]) => ({
			kind: EndpointKind.Group,
			id,
			label: id,
			layoutOrder: nextKey(),
			...inGroup(parent),
		})),
		nodes: witness.nodes.map(([id, , group]) => ({
			kind: EndpointKind.Node,
			id,
			natureId: base.natures[0]?.id ?? 'goal',
			markdown: id,
			layoutOrder: nextKey(),
			...inGroup(group),
		})),
		junctions: (witness.junctions ?? []).map(([id, group]) => ({
			kind: EndpointKind.Junction,
			id,
			operator: JunctionOperator.Xor,
			layoutOrder: nextKey(),
			...inGroup(group),
		})),
		relations: witness.relations.map(([from, to], index) => ({ id: `r${index}`, from, to })),
	};
	const prepared = prepareLayoutDocument(document, {
		nodes: Object.fromEntries(witness.nodes.map(([id, size]) => [id, size])),
		groups: Object.fromEntries(witness.groups.map(([id, size]) => [id, size])),
	});
	const layout = layoutWithDedicatedEngine(prepared.graph, prepared.ranks, prepared.measurements);
	return validateDedicatedCandidate({ ...prepared, layout });
}

describe('group endpoints that hold no node', () => {
	it('keeps a group holding only an empty group as its own relation endpoint', () => {
		expect(
			layoutWitness({
				layout: { direction: LayoutDirection.LeftToRight, bias: LayoutBias.Left },
				nodes: [
					['n0', { width: 270, height: 150 }],
					['n1', { width: 280, height: 160 }],
					['n2', { width: 210, height: 110 }],
				],
				groups: [
					['g0', measurement(210, 60, 40, 32)],
					['g1', measurement(180, 130, 8, 28), 'g0'],
				],
				relations: [
					['n1', 'g1'],
					['n2', 'n0'],
					['n2', 'g0'],
					['n2', 'n1'],
				],
			}),
		).toMatchObject({ valid: true });
	});

	it('ranks an empty subgroup whose parent group is a junction target', () => {
		expect(
			layoutWitness({
				layout: { direction: LayoutDirection.TopToBottom, bias: LayoutBias.Bottom },
				nodes: [
					['n0', { width: 200, height: 160 }],
					['n1', { width: 190, height: 100 }, 'g1'],
					['n2', { width: 80, height: 100 }, 'g1'],
				],
				junctions: [['j0']],
				groups: [
					['g0', measurement(170, 160, 44, 28)],
					['g1', measurement(100, 80, 8, 12)],
					['g2', measurement(190, 120, 32, 12), 'g0'],
				],
				relations: [
					['j0', 'g0'],
					['n2', 'j0'],
					['n1', 'g2'],
				],
			}),
		).toMatchObject({ valid: true });
	});

	it('aligns a relation from a junction-only group on the junction it holds', () => {
		expect(
			layoutWitness({
				layout: { direction: LayoutDirection.TopToBottom, bias: LayoutBias.Top },
				nodes: [
					['n0', { width: 111, height: 160 }],
					['n1', { width: 297, height: 147 }],
					['n2', { width: 188, height: 40 }, 'g2'],
					['n3', { width: 81, height: 158 }],
				],
				junctions: [['j0', 'g0']],
				groups: [
					['g0', measurement(109, 134, 48, 19)],
					['g1', measurement(102, 148, 48, 14)],
					['g2', measurement(107, 107, 9, 29), 'g1'],
				],
				relations: [
					['n0', 'g0'],
					['g0', 'g2'],
				],
			}),
		).toMatchObject({ valid: true });
	});
});
