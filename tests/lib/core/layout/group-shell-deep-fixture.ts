import {
	defined,
	EndpointKind,
	LayoutBias,
	layoutConfiguration,
	LayoutDirection,
	type LogicDocument,
} from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import type { LayoutMeasurementOverrides } from '../../../support/builders/layout-measurements';
import { validLogicDocument } from '../../../support/builders/logic-document';
import { shellReviewRandom } from './group-shell-review-fixture';

/** Preserve every draw of the independent deep-review generator. */
export function deepShellSample(
	seed: number,
	direction: LayoutDirection,
	padding: number,
): { readonly document: LogicDocument; readonly overrides: LayoutMeasurementOverrides } {
	const next = shellReviewRandom(seed);
	const draw = (low: number, high: number) => low + Math.floor(next() * (high - low + 1));
	const count = draw(5, 11);
	const ids = Array.from({ length: count }, (_, index) => `n${index}`);
	const depth = draw(2, 4);
	const members = new Map<string, string>();
	const groups: LogicDocument['groups'][number][] = [];
	let low = 1;
	let high = count - 2;
	for (let level = 0; level < depth && low <= high; level += 1) {
		const id = `g${level}`;
		let groupId: string | undefined;
		if (level > 0) groupId = `g${level - 1}`;
		groups.push({
			kind: EndpointKind.Group,
			id,
			label: id,
			layoutOrder: orderKey(`b${50 + level}`),
			...(groupId !== undefined && { groupId }),
		});
		for (let index = low; index <= high; index += 1) members.set(`n${index}`, id);
		const shrinkLow = draw(0, 1);
		const shrinkHigh = draw(0, 1);
		low += Math.max(shrinkLow, 1 - shrinkHigh);
		high -= shrinkHigh;
	}
	if (next() < 0.4) {
		groups.push({
			kind: EndpointKind.Group,
			id: 'h',
			label: 'h',
			layoutOrder: orderKey(`b${50 + groups.length}`),
		});
		members.set(`n${count - 1}`, 'h');
	}
	const seen = new Set<string>();
	const relations: LogicDocument['relations'][number][] = [];
	const add = (first: number, second: number) => {
		if (first === second) return;
		const source = Math.max(first, second);
		const target = Math.min(first, second);
		const key = `${source}-${target}`;
		if (seen.has(key)) return;
		seen.add(key);
		const from = defined(ids[source]);
		const to = defined(ids[target]);
		relations.push({ id: `${from}-${to}`, from, to });
	};
	for (let index = 1; index < count; index += 1) if (next() < 0.9) add(index, index - 1);
	const extras = draw(1, Math.ceil(count * 1.3));
	for (let index = 0; index < extras; index += 1) add(draw(0, count - 1), draw(0, count - 1));
	const measurements = Object.fromEntries(
		groups.map(({ id }) => [
			id,
			{
				minimumWidth: 160,
				minimumHeight: 72,
				headerHeight: defined([36, 60, 90][draw(0, 2)]),
				padding,
			},
		]),
	);
	let nodes: LayoutMeasurementOverrides['nodes'];
	if (next() < 0.3)
		nodes = Object.fromEntries(
			ids.map((id) => [id, { width: draw(100, 260), height: draw(48, 140) }]),
		);
	let bias = LayoutBias.Top;
	if (direction === LayoutDirection.LeftToRight || direction === LayoutDirection.RightToLeft)
		bias = LayoutBias.Left;
	return {
		document: {
			...validLogicDocument(),
			layout: defined(layoutConfiguration(direction, bias)),
			nodes: ids.map((id, index) => ({
				kind: EndpointKind.Node,
				natureId: 'goal',
				id,
				markdown: id,
				layoutOrder: orderKey(`b${String(index).padStart(2, '0')}`),
				...(members.has(id) && { groupId: defined(members.get(id)) }),
			})),
			groups,
			junctions: [],
			relations,
		},
		overrides: { groups: measurements, ...(nodes !== undefined && { nodes }) },
	};
}
