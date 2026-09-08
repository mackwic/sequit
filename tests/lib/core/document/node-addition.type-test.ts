import { assertType } from 'vitest';

import {
	EndpointKind,
	type LogicNode,
	type NewLogicNode,
} from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import type {
	DocumentCommand,
	DocumentCommandKind,
} from '../../../../src/lib/infrastructure/document/document-command-contracts';

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
