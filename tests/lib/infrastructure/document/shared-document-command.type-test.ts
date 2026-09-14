import { assertType } from 'vitest';

import { GroupState, JunctionOperator } from '../../../../src/lib/core/document/logic-document';
import {
	SharedCommandKind as Op,
	type SharedDocumentCommand,
	SharedElementKind as Kind,
	SharedProperty,
} from '../../../../src/lib/infrastructure/document/shared-document-command';

assertType<SharedDocumentCommand>({
	op: Op.Create,
	target: { kind: Kind.Node, id: 'A' },
	properties: { natureId: 'N', markdown: '**Body**', description: '# Details' },
});
assertType<SharedDocumentCommand>({
	op: Op.Create,
	target: { kind: Kind.Junction, id: 'J' },
	properties: { operator: JunctionOperator.Xor },
});
assertType<SharedDocumentCommand>({
	op: Op.Update,
	target: { kind: Kind.Node, id: 'A' },
	set: { natureId: 'N2' },
	unset: [SharedProperty.Color, SharedProperty.Icon, SharedProperty.GroupId],
});
assertType<SharedDocumentCommand>({
	op: Op.Update,
	target: { kind: Kind.Group, id: 'G' },
	set: { state: GroupState.Closed },
	unset: [],
});

const incompleteNode = {
	op: Op.Create,
	target: { kind: Kind.Node, id: 'A' },
	properties: { markdown: 'Body' },
} as const;
// @ts-expect-error Node creation requires its nature.
assertType<SharedDocumentCommand>(incompleteNode);
const mixedCreation = {
	op: Op.Create,
	target: { kind: Kind.Relation, id: 'R' },
	properties: { natureId: 'N', markdown: 'Body' },
} as const;
// @ts-expect-error Properties belong to the target kind.
assertType<SharedDocumentCommand>(mixedCreation);
const mixedUpdate = {
	op: Op.Update,
	target: { kind: Kind.Relation, id: 'R' },
	set: { color: '#abcdef' },
	unset: [],
} as const;
// @ts-expect-error Relations cannot receive node presentation properties.
assertType<SharedDocumentCommand>(mixedUpdate);
const structuralTextEdit = {
	op: Op.Update,
	target: { kind: Kind.Node, id: 'A' },
	set: { markdown: 'Overwrite' },
	unset: [],
} as const;
// @ts-expect-error Text changes use Y.Text, never structural updates.
assertType<SharedDocumentCommand>(structuralTextEdit);
const removeDescription = {
	op: Op.Update,
	target: { kind: Kind.Node, id: 'A' },
	set: {},
	unset: [SharedProperty.Description],
} as const;
// @ts-expect-error Optional text still belongs to the text channel.
assertType<SharedDocumentCommand>(removeDescription);
const removeNature = {
	op: Op.Update,
	target: { kind: Kind.Node, id: 'A' },
	set: {},
	unset: [SharedProperty.NatureId],
} as const;
// @ts-expect-error Required properties cannot be removed.
assertType<SharedDocumentCommand>(removeNature);
const removeNatureColor = {
	op: Op.Update,
	target: { kind: Kind.Nature, id: 'N' },
	set: {},
	unset: [SharedProperty.Color],
} as const;
// @ts-expect-error A nature's color is required even though a node's override is optional.
assertType<SharedDocumentCommand>(removeNatureColor);
const deleteDocument = { op: Op.Delete, target: { kind: Kind.Document, id: 'D' } } as const;
// @ts-expect-error Document lifecycle is outside element deletion.
assertType<SharedDocumentCommand>(deleteDocument);
const replaceNode = {
	op: Op.Delete,
	target: { kind: Kind.Node, id: 'A' },
	replacementId: 'B',
} as const;
// @ts-expect-error A replacement belongs only to nature deletion.
assertType<SharedDocumentCommand>(replaceNode);
