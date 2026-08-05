import type { addNodeToLiveDocument } from '../../src/lib/collaboration/yjs-live-document';
import {
	EndpointKind,
	type LogicNode,
	type NewLogicNode,
} from '../../src/lib/document/logic-document';
import { orderKey } from '../../src/lib/document/order-key';

const newNode = {
	id: 'new-node',
	natureId: 'goal',
	markdown: 'New node',
} satisfies NewLogicNode;
const accepted: Parameters<typeof addNodeToLiveDocument>[1] = newNode;

const existingNode = {
	...newNode,
	kind: EndpointKind.Node,
	layoutOrder: orderKey('a0'),
} satisfies LogicNode;
// @ts-expect-error Existing domain nodes must not supply an already allocated key.
const rejected: Parameters<typeof addNodeToLiveDocument>[1] = existingNode;

void accepted;
void rejected;
