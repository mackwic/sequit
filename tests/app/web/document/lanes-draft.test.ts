import { describe, expect, it } from 'vitest';

import {
	activateLanes,
	addLane,
	disableLanes,
	draftRootLanes,
	draftTransfers,
	lanesDraft,
	moveLane,
	pendingTransfers,
	removeLane,
	renameLane,
	submittableLanes,
	transferLane,
} from '../../../../src/app/web/document/lanes-draft';
import { LaneOrientation } from '../../../../src/lib/core/document/logic-document';
import {
	explicitLaneLogicDocument,
	validLogicDocument,
} from '../../../support/builders/logic-document';

describe('lanesDraft', () => {
	it('starts empty without lanes, then activates two lanes to rename', () => {
		let ids = 0;
		const draft = lanesDraft(validLogicDocument());
		expect(draft.lanes).toEqual([]);
		expect(draftRootLanes(draft)).toBeUndefined();
		const activated = activateLanes(draft, () => `lane-${(ids += 1)}`);
		expect(activated.lanes).toEqual([
			{ id: 'lane-1', label: 'Lane 1' },
			{ id: 'lane-2', label: 'Lane 2' },
		]);
		const renamed = renameLane(activated, 'lane-2', ' Client ');
		const lanes = draftRootLanes(renamed);
		expect(lanes?.lanes.map(({ label }) => label)).toEqual(['Lane 1', 'Client']);
		expect(submittableLanes(renameLane(activated, 'lane-1', '  '))).toBe(false);
	});

	it('reads existing lanes in order with their content, and reorders by fresh keys', () => {
		const draft = lanesDraft(explicitLaneLogicDocument());
		expect(draft.existing.map(({ id, count }) => [id, count])).toEqual([
			['left', 3],
			['right', 2],
		]);
		const moved = moveLane(addLane(draft, 'middle'), 'middle', -1);
		expect(moved.lanes.map(({ id }) => id)).toEqual(['left', 'middle', 'right']);
		expect(moveLane(moved, 'left', -1)).toBe(moved);
		const lanes = draftRootLanes(moved);
		if (lanes === undefined) throw new Error('Expected lanes');
		const orders = lanes.lanes.map(({ layoutOrder }) => layoutOrder);
		expect([...orders].sort()).toEqual(orders);
	});

	it('sends the content of a removed lane to the first remaining lane unless chosen otherwise', () => {
		const draft = addLane(lanesDraft(explicitLaneLogicDocument()), 'middle');
		const removed = removeLane(draft, 'left');
		expect(pendingTransfers(removed)).toEqual([
			{ lane: { id: 'left', label: 'Left', count: 3 }, target: 'right' },
		]);
		const chosen = transferLane(removed, 'left', 'middle');
		expect(draftTransfers(chosen)).toEqual({ left: 'middle' });
		expect(draftTransfers(removeLane(chosen, 'middle'))).toEqual({ left: 'right' });
		expect(draftTransfers(disableLanes(chosen))).toEqual({});
		expect(draftRootLanes(disableLanes(chosen))).toBeUndefined();
	});

	it('keeps the orientation of the document', () => {
		expect(lanesDraft(explicitLaneLogicDocument()).orientation).toBe(LaneOrientation.Parallel);
	});
});
