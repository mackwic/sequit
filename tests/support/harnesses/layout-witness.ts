import {
	EndpointKind,
	JunctionOperator,
	type LayoutConfiguration,
	type LogicDocument,
} from '../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../src/lib/core/document/order-key';
import type { DedicatedCandidateValidation } from '../../../src/lib/core/layout/dedicated-candidate-validation/types';
import { validateDedicatedCandidate } from '../../../src/lib/core/layout/dedicated-candidate-validation/validate';
import { layoutWithDedicatedEngine } from '../../../src/lib/core/layout/layout-engine';
import type { GroupMeasurement, Size } from '../../../src/lib/core/layout/layout-types';
import { validLogicDocument } from '../builders/logic-document';
import { prepareLayoutDocument } from './layout';

/** A small document written as tuples, as property counterexamples are reported. */
export interface LayoutWitness {
	readonly layout: LayoutConfiguration;
	/** Node id, size and optional group. */
	readonly nodes: readonly (readonly [string, Size, string?])[];
	readonly junctions?: readonly (readonly [string, string?])[];
	/** Group id, measurement and optional parent group. */
	readonly groups: readonly (readonly [string, GroupMeasurement, string?])[];
	readonly relations: readonly (readonly [string, string])[];
}

export function measurement(
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

/** Lay the witness out with the dedicated engine and validate the published candidate. */
export function layoutWitness(witness: LayoutWitness): DedicatedCandidateValidation {
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
		relations: witness.relations.map(([from, to], index) => ({
			id: `r${index}`,
			from,
			to,
		})),
	};
	const prepared = prepareLayoutDocument(document, {
		nodes: Object.fromEntries(witness.nodes.map(([id, size]) => [id, size])),
		groups: Object.fromEntries(witness.groups.map(([id, size]) => [id, size])),
	});
	const layout = layoutWithDedicatedEngine(prepared.graph, prepared.ranks, prepared.measurements);
	return validateDedicatedCandidate({ ...prepared, layout });
}
