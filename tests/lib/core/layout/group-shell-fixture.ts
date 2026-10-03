import {
	defined,
	EndpointKind,
	LayoutBias,
	layoutConfiguration,
	LayoutDirection,
	type LogicDocument,
} from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import { validLogicDocument } from '../../../support/builders/logic-document';

export interface ShellShape {
	readonly count: number;
	readonly nested: boolean;
	readonly groups: number;
	readonly edges: readonly (readonly [number, number])[];
}

/** A chain crosses one or two contiguous shells; additional edges bypass arbitrary rows. */
export function shellDocument(shape: ShellShape, direction: LayoutDirection): LogicDocument {
	const base = validLogicDocument();
	const ids = Array.from({ length: shape.count }, (_, index) => `n${index}`);
	const groups: LogicDocument['groups'] = Array.from({ length: shape.groups }, (_, index) => ({
		kind: EndpointKind.Group,
		id: `g${index}`,
		label: `G${index}`,
		layoutOrder: orderKey(`a${index}`),
		...(index === 1 && shape.nested && { groupId: 'g0' }),
	}));
	const nodes: LogicDocument['nodes'] = ids.map((id, index) => {
		let groupId: string | undefined;
		if (index > 0 && index < shape.count - 1) groupId = 'g0';
		if (shape.groups === 2 && index > 1 && index < shape.count - 1) groupId = 'g1';
		return {
			kind: EndpointKind.Node,
			natureId: 'goal',
			id,
			markdown: id,
			...(groupId !== undefined && { groupId }),
			layoutOrder: orderKey(`a${index}`),
		};
	});
	const pairs: (readonly [number, number])[] = ids.slice(1).map((_, index) => [index + 1, index]);
	pairs.push([shape.count - 1, 0], ...shape.edges);
	const relations: LogicDocument['relations'][number][] = [];
	for (const pair of pairs) {
		const high = Math.max(...pair) % shape.count;
		const low = Math.min(...pair) % shape.count;
		if (high === low) continue;
		const from = defined(ids[Math.max(high, low)]);
		const to = defined(ids[Math.min(high, low)]);
		if (relations.some((relation) => relation.from === from && relation.to === to)) continue;
		relations.push({ id: `${from}-${to}`, from, to });
	}
	let bias = LayoutBias.Top;
	if (direction === LayoutDirection.LeftToRight || direction === LayoutDirection.RightToLeft)
		bias = LayoutBias.Left;
	return {
		...base,
		layout: defined(layoutConfiguration(direction, bias)),
		nodes,
		groups,
		junctions: [],
		relations,
	};
}
