import { describe, expect, it } from 'vitest';

import { DropRefusal } from '../../../../../../src/app/web/ui/canvas/drag-drop';
import { connectionRefusal } from '../../../../../../src/app/web/ui/components/canvas/drop-feedback';
import {
	EndpointKind,
	type LogicDocument,
} from '../../../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../../../src/lib/core/document/order-key';
import { validLogicDocument } from '../../../../../support/builders/logic-document';

/** `child → middle → goal`, and `loose` on its own. */
function chain(): LogicDocument {
	const node = (id: string, layoutOrder: string) => ({
		kind: EndpointKind.Node as const,
		id,
		natureId: 'first',
		markdown: id,
		layoutOrder: orderKey(layoutOrder),
	});
	return {
		...validLogicDocument(),
		natures: [{ id: 'first', label: 'First', color: '#111111' }],
		groups: [],
		junctions: [],
		nodes: [node('goal', 'a0'), node('middle', 'a1'), node('child', 'a2'), node('loose', 'a3')],
		relations: [
			{ id: 'middle-goal', from: 'middle', to: 'goal' },
			{ id: 'child-middle', from: 'child', to: 'middle' },
		],
	};
}

describe('connectionRefusal', () => {
	it('accepts a relation the document can hold', () => {
		expect(connectionRefusal(chain(), 'loose', 'middle')).toBeUndefined();
		expect(connectionRefusal(chain(), 'child', 'goal')).toBeUndefined();
	});

	it('refuses a relation that closes a cycle, even through another box', () => {
		expect(connectionRefusal(chain(), 'goal', 'middle')).toBe(DropRefusal.Cycle);
		expect(connectionRefusal(chain(), 'goal', 'child')).toBe(DropRefusal.Cycle);
	});

	it('refuses a relation that already exists', () => {
		expect(connectionRefusal(chain(), 'middle', 'goal')).toBe(DropRefusal.Duplicate);
	});
});
