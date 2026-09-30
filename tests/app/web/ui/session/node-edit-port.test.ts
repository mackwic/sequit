import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import {
	attachLocalDocumentSession,
	type LocalDocumentSession,
} from '../../../../../src/app/web/document/local-document-session';
import { createNodeEditPort } from '../../../../../src/app/web/ui/session/node-edit-port';
import type { LogicDocument } from '../../../../../src/lib/core/document/logic-document';
import { importLogicDocument } from '../../../../../src/lib/infrastructure/collaboration/yjs-document-codec';
import { DocumentCommandOutcomeKind } from '../../../../../src/lib/infrastructure/document/document-command-contracts';
import {
	SharedCommandKind,
	SharedElementKind,
} from '../../../../../src/lib/infrastructure/document/shared-document-command';
import { parseSequitToml } from '../../../../../src/lib/infrastructure/toml/parse-sequit-toml';
import { aiDocumentaryEffortScenario } from '../../../../support/scenarios/ai-documentary-effort';

const nodeId = 'traceable-edits';
const target = { kind: SharedElementKind.Node, id: nodeId } as const;
const sessions: LocalDocumentSession[] = [];
const documents: Y.Doc[] = [];

async function referenceDocument(): Promise<LogicDocument> {
	const parsed = parseSequitToml(await aiDocumentaryEffortScenario());
	if (!parsed.ok) throw new Error('Reference document must parse');
	return parsed.value;
}

async function withEditableNode(
	fields: Partial<LogicDocument['nodes'][number]>,
): Promise<LogicDocument> {
	const source = await referenceDocument();
	return {
		...source,
		nodes: source.nodes.map((node) => {
			if (node.id !== nodeId) return node;
			return { ...node, ...fields };
		}),
	};
}

async function open(document?: LogicDocument) {
	const ydoc = new Y.Doc();
	importLogicDocument(ydoc, document ?? (await referenceDocument()));
	const session = attachLocalDocumentSession(ydoc);
	sessions.push(session);
	documents.push(ydoc);
	return { session, port: createNodeEditPort(session) };
}

afterEach(() => {
	for (const session of sessions) session.destroy();
	for (const document of documents) document.destroy();
	sessions.length = 0;
	documents.length = 0;
	vi.restoreAllMocks();
});

describe('node edit port', () => {
	it('splices Markdown without dispatching a document command', async () => {
		const { session, port } = await open();
		const base = port.readNode(nodeId);
		if (base === undefined) throw new Error('Expected the editable node');
		const markdown = session.text(target, 'markdown');
		if (markdown === undefined) throw new Error('Expected shared Markdown');
		const dispatch = vi.spyOn(session, 'dispatch');

		const outcome = await port.saveNode(nodeId, base, {
			...base,
			markdown: 'Revised content',
		});

		expect(outcome.kind).toBe(DocumentCommandOutcomeKind.Accepted);
		expect(markdown.toJSON()).toBe('Revised content');
		expect(session.text(target, 'markdown')).toBe(markdown);
		expect(dispatch).not.toHaveBeenCalled();
	});

	it('splices an existing description text in place without a command', async () => {
		const document = await withEditableNode({ description: 'Existing description' });
		const { session, port } = await open(document);
		const base = port.readNode(nodeId);
		if (base === undefined) throw new Error('Expected the editable node');
		const description = session.text(target, 'description');
		if (description === undefined) throw new Error('Expected shared description');
		const dispatch = vi.spyOn(session, 'dispatch');

		const outcome = await port.saveNode(nodeId, base, {
			...base,
			description: 'Revised description',
		});

		expect(outcome.kind).toBe(DocumentCommandOutcomeKind.Accepted);
		expect(description.toJSON()).toBe('Revised description');
		expect(session.text(target, 'description')).toBe(description);
		expect(dispatch).not.toHaveBeenCalled();
	});

	it('combines nature, colour, and icon changes in one Update with a cleared colour unset', async () => {
		const nextNature = { id: 'another-nature', label: 'Another', color: '#123456' };
		const source = await withEditableNode({ color: '#654321', icon: 'phosphor:flag' });
		const document: LogicDocument = { ...source, natures: [...source.natures, nextNature] };
		const { session, port } = await open(document);
		const base = port.readNode(nodeId);
		if (base === undefined) throw new Error('Expected the editable node');
		const dispatch = vi.spyOn(session, 'dispatch');

		const outcome = await port.saveNode(nodeId, base, {
			...base,
			natureId: nextNature.id,
			color: '',
			icon: 'phosphor:lightning',
		});

		expect(outcome.kind).toBe(DocumentCommandOutcomeKind.Accepted);
		expect(dispatch).toHaveBeenCalledExactlyOnceWith([
			{
				op: SharedCommandKind.Update,
				target,
				set: { natureId: nextNature.id, icon: 'phosphor:lightning' },
				unset: ['color'],
			},
		]);
		expect(session.read().nodes.find(({ id }) => id === nodeId)).toMatchObject({
			natureId: nextNature.id,
			icon: 'phosphor:lightning',
		});
		expect(session.read().nodes.find(({ id }) => id === nodeId)).not.toHaveProperty('color');
	});

	it('accepts an unchanged draft without dispatching a command', async () => {
		const { session, port } = await open();
		const base = port.readNode(nodeId);
		if (base === undefined) throw new Error('Expected the editable node');
		const dispatch = vi.spyOn(session, 'dispatch');

		const outcome = await port.saveNode(nodeId, base, base);

		expect(outcome.kind).toBe(DocumentCommandOutcomeKind.Accepted);
		expect(dispatch).not.toHaveBeenCalled();
	});

	it('rejects an Update after applying the Markdown splice', async () => {
		const { session, port } = await open();
		const base = port.readNode(nodeId);
		if (base === undefined) throw new Error('Expected the editable node');
		const markdown = session.text(target, 'markdown');
		if (markdown === undefined) throw new Error('Expected shared Markdown');

		const outcome = await port.saveNode(nodeId, base, {
			...base,
			markdown: 'Markdown already applied',
			natureId: 'unknown-nature',
		});

		expect(outcome).toMatchObject({
			kind: DocumentCommandOutcomeKind.Rejected,
			diagnostics: [{ code: 'command-refused' }],
		});
		expect(markdown.toJSON()).toBe('Markdown already applied');
		expect(session.read().nodes.find(({ id }) => id === nodeId)?.markdown).toBe(
			'Markdown already applied',
		);
	});
});
