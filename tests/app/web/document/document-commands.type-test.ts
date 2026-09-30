import { assertType } from 'vitest';

import type { nodeCreation } from '../../../../src/app/web/document/document-commands';
import {
	EndpointKind,
	type LogicNode,
	type NewLogicNode,
} from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';

type CreatedNode = Parameters<typeof nodeCreation>[0];

const newNode = {
	id: 'new-node',
	natureId: 'goal',
	markdown: 'New node',
} satisfies NewLogicNode;
assertType<CreatedNode>(newNode);

const existingNode = {
	...newNode,
	kind: EndpointKind.Node,
	layoutOrder: orderKey('a0'),
} satisfies LogicNode;
// @ts-expect-error Existing domain nodes must not supply an already allocated key.
assertType<CreatedNode>(existingNode);
