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

/** Mulberry32 preserves the review corpus, including the order of measurement draws. */
export function shellReviewRandom(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let value = Math.imul(state ^ (state >>> 15), state | 1);
		const mixed = Math.imul(value ^ (value >>> 7), value | 61);
		value ^= value + mixed;
		return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
	};
}

function chooseMembers(
	pool: readonly string[],
	contiguous: boolean,
	draw: (low: number, high: number) => number,
	next: () => number,
): readonly string[] {
	if (contiguous) {
		const low = draw(0, pool.length - 1);
		return pool.slice(low, draw(low, pool.length - 1) + 1);
	}
	const chosen = pool.filter(() => next() < 0.45);
	if (chosen.length === 0) return pool.slice(0, 1);
	return chosen;
}

export function reviewedShellSample(
	seed: number,
	direction: LayoutDirection,
	padding?: number,
): { readonly document: LogicDocument; readonly overrides: LayoutMeasurementOverrides } {
	const next = shellReviewRandom(seed);
	const draw = (low: number, high: number) => low + Math.floor(next() * (high - low + 1));
	const count = draw(4, 9);
	const ids = Array.from({ length: count }, (_, index) => `n${index}`);
	const groupCount = draw(1, 2);
	const nested = groupCount === 2 && next() < 0.5;
	const contiguous = next() < 0.6;
	const members = new Map<string, string>();
	const outer = chooseMembers(ids.slice(1, -1), contiguous, draw, next);
	for (const id of outer) members.set(id, 'g0');
	const groups: LogicDocument['groups'][number][] = [
		{ kind: EndpointKind.Group, id: 'g0', label: 'g0', layoutOrder: orderKey('b50') },
	];
	if (groupCount === 2) {
		if (nested) {
			for (const id of chooseMembers(outer, contiguous, draw, next)) members.set(id, 'g1');
			groups.push({
				kind: EndpointKind.Group,
				id: 'g1',
				label: 'g1',
				groupId: 'g0',
				layoutOrder: orderKey('b51'),
			});
		} else {
			const rest = ids.filter((id) => !members.has(id));
			if (rest.length > 0) {
				for (const id of chooseMembers(rest, contiguous, draw, next)) members.set(id, 'g1');
				groups.push({
					kind: EndpointKind.Group,
					id: 'g1',
					label: 'g1',
					layoutOrder: orderKey('b51'),
				});
			}
		}
	}
	const relations: LogicDocument['relations'][number][] = [];
	const add = (first: number, second: number) => {
		if (first === second) return;
		const from = defined(ids[Math.max(first, second)]);
		const to = defined(ids[Math.min(first, second)]);
		if (relations.some((relation) => relation.from === from && relation.to === to)) return;
		relations.push({ id: `${from}-${to}`, from, to });
	};
	for (let index = 1; index < count; index += 1) if (next() < 0.85) add(index, index - 1);
	const extras = draw(0, Math.ceil(count * 1.2));
	for (let index = 0; index < extras; index += 1) add(draw(0, count - 1), draw(0, count - 1));
	if (relations.length === 0) add(1, 0);
	const measurements = Object.fromEntries(
		groups.map(({ id }) => {
			const headerHeight = defined([36, 60, 90][draw(0, 2)]);
			let inset = padding;
			inset ??= defined([8, 12, 16, 24, 36, 48][draw(0, 5)]);
			return [id, { minimumWidth: 160, minimumHeight: 72, headerHeight, padding: inset }];
		}),
	);
	let nodeSizes: LayoutMeasurementOverrides['nodes'];
	if (next() < 0.3)
		nodeSizes = Object.fromEntries(
			ids.map((id) => [id, { width: draw(100, 260), height: draw(48, 140) }]),
		);
	let bias = LayoutBias.Top;
	if (direction === LayoutDirection.LeftToRight || direction === LayoutDirection.RightToLeft)
		bias = LayoutBias.Left;
	return {
		document: {
			...validLogicDocument(),
			layout: defined(layoutConfiguration(direction, bias)),
			groups,
			junctions: [],
			relations,
			nodes: ids.map((id, index) => {
				const groupId = members.get(id);
				return {
					kind: EndpointKind.Node,
					id,
					natureId: 'goal',
					markdown: id,
					layoutOrder: orderKey(`b${String(index).padStart(2, '0')}`),
					...(groupId !== undefined && { groupId }),
				};
			}),
		},
		overrides: { groups: measurements, ...(nodeSizes !== undefined && { nodes: nodeSizes }) },
	};
}
