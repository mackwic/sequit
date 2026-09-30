import { expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { nodeCreation } from '../../../../src/app/web/document/document-commands';
import { attachLocalDocumentSession } from '../../../../src/app/web/document/local-document-session';
import { SourceDocumentStateKind } from '../../../../src/lib/infrastructure/collaboration/source-document-state';
import { importLogicDocument } from '../../../../src/lib/infrastructure/collaboration/yjs-document-codec';
import {
	createYjsEntityMap,
	YjsCollection,
} from '../../../../src/lib/infrastructure/collaboration/yjs-document-schema';
import { DocumentCommandOutcomeKind } from '../../../../src/lib/infrastructure/document/document-command-contracts';
import { parseSequitToml } from '../../../../src/lib/infrastructure/toml/parse-sequit-toml';
import { aiDocumentaryEffortScenario } from '../../../support/scenarios/ai-documentary-effort';

it('publishes the physical invalid Yjs snapshot and recovery without replacing accepted command state', async () => {
	const parsed = parseSequitToml(await aiDocumentaryEffortScenario());
	if (!parsed.ok) throw new Error('Reference document must parse');
	const ydoc = new Y.Doc();
	importLogicDocument(ydoc, parsed.value);
	const session = attachLocalDocumentSession(ydoc);
	const accepted = session.read();
	const acceptedSubscriber = vi.fn();
	const sourceSubscriber = vi.fn();
	session.subscribe(acceptedSubscriber);
	session.subscribeToSourceState(sourceSubscriber);
	const relations = ydoc.getMap<Y.Map<unknown>>(YjsCollection.Relations);
	const invalidRelationId = 'physical-dangling-relation';

	relations.set(
		invalidRelationId,
		createYjsEntityMap({ from: 'traceable-edits', to: 'missing-physical-node' }),
	);

	const invalid = session.readSourceState();
	expect(invalid.kind).toBe(SourceDocumentStateKind.Invalid);
	if (invalid.kind !== SourceDocumentStateKind.Invalid)
		throw new Error('Expected an invalid physical snapshot');
	expect(invalid.revision).toBe(1);
	expect(invalid.diagnostics[0]).toMatchObject({ code: 'invalid-yjs-live-document' });
	expect(invalid.snapshot.relationIds).toContain(invalidRelationId);
	expect(invalid.snapshot.nodeIds).not.toContain('missing-physical-node');
	expect(session.read()).toBe(accepted);
	expect(accepted.relations.map(({ id }) => id)).not.toContain(invalidRelationId);
	expect(acceptedSubscriber).not.toHaveBeenCalled();
	expect(sourceSubscriber).toHaveBeenCalledExactlyOnceWith(invalid);
	await expect(
		session.dispatch([
			nodeCreation({ id: 'blocked-on-invalid-base', natureId: 'goal', markdown: 'Blocked' }),
		]),
	).resolves.toMatchObject({ kind: DocumentCommandOutcomeKind.Rejected });
	expect(session.read()).toBe(accepted);
	expect(relations.has(invalidRelationId)).toBe(true);

	relations.delete(invalidRelationId);

	const healed = session.readSourceState();
	expect(healed.kind).toBe(SourceDocumentStateKind.Valid);
	if (healed.kind !== SourceDocumentStateKind.Valid)
		throw new Error('Expected a healed physical snapshot');
	expect(healed.revision).toBe(2);
	expect(healed.document.relations.map(({ id }) => id)).not.toContain(invalidRelationId);
	expect(session.read().relations).toEqual(accepted.relations);
	expect(acceptedSubscriber).toHaveBeenCalledOnce();
	expect(sourceSubscriber).toHaveBeenCalledTimes(2);
	expect(sourceSubscriber).toHaveBeenLastCalledWith(healed);
	const afterHeal = await session.dispatch([
		nodeCreation({ id: 'accepted-after-heal', natureId: 'goal', markdown: 'Recovered' }),
	]);
	if (afterHeal.kind !== DocumentCommandOutcomeKind.Accepted)
		throw new Error('Expected acceptance after healing');
	expect(afterHeal.document.nodes.map(({ id }) => id)).toContain('accepted-after-heal');
	session.destroy();
	ydoc.destroy();
});
