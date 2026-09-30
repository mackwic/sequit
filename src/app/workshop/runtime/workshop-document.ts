import * as Y from 'yjs';

import {
	defined,
	type LogicDocument,
	type LogicRelation,
} from '../../../lib/core/document/logic-document';
import { validateLogicDocument } from '../../../lib/core/document/validate-logic-document';
import { createGraph } from '../../../lib/core/graph/create-graph';
import { reconcileSharedDocument } from '../../../lib/infrastructure/collaboration/reconcile-shared-document';
import {
	importLogicDocument,
	readLogicDocument,
} from '../../../lib/infrastructure/collaboration/yjs-document-codec';
import { YjsCollection } from '../../../lib/infrastructure/collaboration/yjs-document-schema';
import { DocumentCommandOutcomeKind } from '../../../lib/infrastructure/document/document-command-contracts';
import { DocumentSessionError } from '../../../lib/infrastructure/document/document-session-contracts';
import { parseSequitToml } from '../../../lib/infrastructure/toml/parse-sequit-toml';
import { serializeSequitToml } from '../../../lib/infrastructure/toml/serialize-sequit-toml';
import { relationCreation } from '../../web/document/document-commands';
import { attachLocalDocumentSession } from '../../web/document/local-document-session';
import { openDocument } from '../../web/projection/open-document';
import { WorkshopCommands } from './workshop-commands';

/** Local prototype adapter. Relations still run through the local document session.
 * Experimental edits are validated before a fine-grained Yjs transaction.
 * This adapter is never used by the collaboration authority. */
export class WorkshopDocument {
	readonly ydoc: Y.Doc;
	readonly opened;
	readonly commands: WorkshopCommands;
	readonly history: Y.UndoManager;
	private readonly origin = Symbol('workshop edit');
	private readonly trackOrigin: (transaction: Y.Transaction) => void;
	private readonly stopCapture: () => void;
	constructor(source: string) {
		const parsed = parseSequitToml(source);
		if (!parsed.ok) throw new Error(parsed.diagnostics.map(({ message }) => message).join('; '));
		const graph = createGraph(parsed.value);
		if (!graph.ok) throw new Error(graph.diagnostics.map(({ message }) => message).join('; '));
		this.ydoc = new Y.Doc();
		importLogicDocument(this.ydoc, parsed.value);
		const opened = openDocument(source, () => attachLocalDocumentSession(this.ydoc));
		if (!opened.ok) {
			this.ydoc.destroy();
			throw new Error(opened.diagnostics.map(({ message }) => message).join('; '));
		}
		this.opened = opened.value;
		this.commands = new WorkshopCommands(
			(change) => {
				this.edit(change);
			},
			(relation) => this.addRelation(relation),
		);
		this.history = new Y.UndoManager(
			Object.values(YjsCollection).map((name) => this.ydoc.getMap(name)),
			{ captureTimeout: 0 },
		);
		this.trackOrigin = (transaction) => {
			if (typeof transaction.origin === 'symbol')
				this.history.trackedOrigins.add(transaction.origin);
		};
		this.stopCapture = () => {
			this.history.stopCapturing();
		};
		this.ydoc.on('beforeTransaction', this.trackOrigin);
		this.ydoc.on('afterTransaction', this.stopCapture);
	}
	read(): LogicDocument {
		const current = readLogicDocument(this.ydoc);
		if (!current.ok) throw new Error(current.diagnostics.map(({ message }) => message).join('; '));
		return current.value;
	}
	/** Keeps the workshop contract: an accepted relation yields its document, a refusal throws. */
	private async addRelation(relation: LogicRelation): Promise<LogicDocument> {
		const outcome = await this.opened.session.dispatch([relationCreation(relation)]);
		if (outcome.kind === DocumentCommandOutcomeKind.Accepted) return outcome.document;
		if (outcome.kind === DocumentCommandOutcomeKind.Failed) throw outcome.error;
		throw new DocumentSessionError(
			outcome.diagnostics.map(({ message }) => message).join('; '),
			outcome.diagnostics,
		);
	}
	/** Read at invocation, validate the complete operation, then commit once. */
	edit(change: (current: LogicDocument) => LogicDocument): void {
		this.apply(change(this.read()));
	}
	apply(next: LogicDocument): void {
		const valid = validateLogicDocument(next);
		if (!valid.ok) throw new Error(valid.diagnostics.map(({ message }) => message).join('; '));
		const graph = createGraph(next);
		if (!graph.ok) throw new Error(graph.diagnostics.map(({ message }) => message).join('; '));
		reconcileSharedDocument(this.ydoc, next, this.origin);
	}
	import(source: string): void {
		const parsed = parseSequitToml(source);
		if (!parsed.ok) throw new Error(parsed.diagnostics.map(({ message }) => message).join('; '));
		this.apply(parsed.value);
	}
	text(): string {
		return serializeSequitToml(this.read());
	}
	node(id: string): LogicDocument['nodes'][number] {
		return defined(this.read().nodes.find((node) => node.id === id));
	}
	destroy(): void {
		this.ydoc.off('beforeTransaction', this.trackOrigin);
		this.ydoc.off('afterTransaction', this.stopCapture);
		this.history.destroy();
		this.opened.destroy();
		this.ydoc.destroy();
	}
}
