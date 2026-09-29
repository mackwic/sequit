import { defined } from '../../../src/lib/core/document/logic-document';
import type { Bounds } from '../../../src/lib/core/layout/layout-types';
import { axesFor } from '../harnesses/visual-directions';
import type { VisualLayout } from '../harnesses/visual-layout';
import { minimumMetric } from './routing-measurements';

/** Minimum free space between a group frame and a foreign box, along and across the flow. */
export interface FrameClearance {
	readonly along: number;
	readonly across: number;
}

function gapOn(a: Bounds, b: Bounds, axis: 'x' | 'y'): number {
	let size: 'width' | 'height' = 'height';
	if (axis === 'x') size = 'width';
	return Math.max(a[axis] - b[axis] - b[size], b[axis] - a[axis] - a[size]);
}

/** The group, its descendants and its ancestors: every element allowed to meet its frame. */
function relatives(layout: VisualLayout, groupId: string): ReadonlySet<string> {
	const document = defined(layout.document, 'Group membership must be observable.');
	const members = [...document.nodes, ...document.junctions, ...document.groups];
	const parents = new Map(members.map(({ id, groupId: parent }) => [id, parent]));
	const related = new Set([groupId]);
	for (
		let ancestor = parents.get(groupId);
		ancestor !== undefined;
		ancestor = parents.get(ancestor)
	)
		related.add(ancestor);
	const pending = [groupId];
	for (let current = pending.pop(); current !== undefined; current = pending.pop())
		for (const { id, groupId: parent } of members)
			if (parent === current && !related.has(id)) {
				related.add(id);
				pending.push(id);
			}
	return related;
}

/**
 * No element outside the group's subtree may enter its frame. A box facing the frame along the
 * flow keeps `along`; a box beside it on the transverse axis keeps `across`.
 */
export function assertGroupClearOfForeignBoxes(
	layout: VisualLayout,
	groupId: string,
	clearance: FrameClearance,
): void {
	const frame = layout.getById(groupId).bounds;
	const related = relatives(layout, groupId);
	const { primary, transverse } = axesFor(layout.direction);
	for (const element of layout.elements) {
		if (related.has(element.id)) continue;
		const along = gapOn(frame, element.bounds, primary);
		const across = gapOn(frame, element.bounds, transverse);
		if (along >= clearance.along || across >= clearance.across) continue;
		let label = 'Dégagement le long du flux entre le cadre du groupe et une boîte étrangère';
		let observed = along;
		let minimum = clearance.along;
		if (across >= 0 && along < 0) {
			label = 'Dégagement transversal entre le cadre du groupe et une boîte étrangère';
			observed = across;
			minimum = clearance.across;
		}
		minimumMetric(label, observed, minimum, { boxes: [groupId, element.id] });
	}
}
