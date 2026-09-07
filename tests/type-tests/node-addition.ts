import { assertType } from 'vitest';

import type {
	DocumentCommand,
	DocumentCommandKind,
} from '../../src/lib/document/document-command-gateway';
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
type AddNodeCommand = Extract<DocumentCommand, { readonly kind: DocumentCommandKind.AddNode }>;
assertType<AddNodeCommand['node']>(newNode);

const existingNode = {
	...newNode,
	kind: EndpointKind.Node,
	layoutOrder: orderKey('a0'),
} satisfies LogicNode;
// @ts-expect-error Existing domain nodes must not supply an already allocated key.
assertType<AddNodeCommand['node']>(existingNode);
