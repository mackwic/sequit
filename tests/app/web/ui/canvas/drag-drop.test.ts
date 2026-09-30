import { describe, expect, it } from 'vitest';

import {
	CONNECTION_BAND,
	type DropContext,
	DropKind,
	insideConnectionBand,
	planDrop,
} from '../../../../../src/app/web/ui/canvas/drag-drop';

/** `outer` ⊃ `inner` ⊃ `a`; `b` and `other` sit at the root; `c` sits in `outer`. */
const CONTAINERS: Record<string, string | undefined> = {
	a: 'inner',
	inner: 'outer',
	c: 'outer',
};
function context(from: string, selected: readonly string[] = []): DropContext {
	return { from, selected, containerOf: (id) => CONTAINERS[id] };
}

describe('planDrop', () => {
	it('connects to a node, but never to the dragged element or an enclosing group', () => {
		expect(planDrop(context('a'), { id: 'b', group: false, band: false })).toEqual({
			kind: DropKind.Connect,
			to: 'b',
		});
		expect(planDrop(context('a'), { id: 'a', group: false, band: false })).toBeUndefined();
		expect(planDrop(context('a'), { id: 'outer', group: true, band: true })).toBeUndefined();
	});

	it('connects on a group band and moves on its interior', () => {
		expect(planDrop(context('b'), { id: 'inner', group: true, band: true })).toEqual({
			kind: DropKind.Connect,
			to: 'inner',
		});
		expect(planDrop(context('b'), { id: 'inner', group: true, band: false })).toEqual({
			kind: DropKind.Move,
			ids: ['b'],
			groupId: 'inner',
		});
	});

	it('moves the selection with the dragged element, dropping those already in place', () => {
		expect(
			planDrop(context('a', ['a', 'b', 'c']), { id: 'outer', group: true, band: false }),
		).toEqual({ kind: DropKind.Move, ids: ['a', 'b'], groupId: 'outer' });
		expect(
			planDrop(context('other', ['a', 'b']), { id: 'inner', group: true, band: false }),
		).toEqual({ kind: DropKind.Move, ids: ['other'], groupId: 'inner' });
	});

	it('returns to the root on the background and ignores elements already there', () => {
		expect(planDrop(context('a', ['a', 'b']), undefined)).toEqual({
			kind: DropKind.Move,
			ids: ['a'],
		});
		expect(planDrop(context('b'), undefined)).toBeUndefined();
	});

	it('never lets a group enter itself or a descendant', () => {
		expect(planDrop(context('outer'), { id: 'inner', group: true, band: false })).toBeUndefined();
		expect(planDrop(context('inner'), { id: 'inner', group: true, band: false })).toBeUndefined();
		expect(
			planDrop(context('inner', ['inner', 'b']), { id: 'inner', group: true, band: false }),
		).toEqual({ kind: DropKind.Move, ids: ['b'], groupId: 'inner' });
	});
});

describe('insideConnectionBand', () => {
	const bounds = { left: 0, top: 0, right: 200, bottom: 100 };
	const header = { left: 0, top: 0, right: 200, bottom: 24 };
	it('covers the header and the inner band, not the interior', () => {
		expect(insideConnectionBand(bounds, header, 100, 20)).toBe(true);
		expect(insideConnectionBand(bounds, undefined, 100, CONNECTION_BAND - 1)).toBe(true);
		expect(insideConnectionBand(bounds, undefined, 200 - CONNECTION_BAND + 1, 50)).toBe(true);
		expect(insideConnectionBand(bounds, header, 100, 50)).toBe(false);
		expect(insideConnectionBand(bounds, undefined, CONNECTION_BAND, CONNECTION_BAND)).toBe(false);
	});
});
