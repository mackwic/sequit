import * as Y from 'yjs';

import {
	importLogicDocument,
	readLogicDocument,
} from '../../../lib/collaboration/yjs-document-codec';
import { createYjsEntityMap, YjsCollection } from '../../../lib/collaboration/yjs-document-schema';
import { attachDocumentSession } from '../../../lib/collaboration/yjs-document-session';
import { defined, type LogicDocument } from '../../../lib/document/logic-document';
import { openDocument } from '../../../lib/document/open-document';
import { validateLogicDocument } from '../../../lib/document/validate-logic-document';
import { createGraph } from '../../../lib/graph/create-graph';
import { parseSequitToml } from '../../../lib/text/parse-sequit-toml';
import { serializeSequitToml } from '../../../lib/text/serialize-sequit-toml';
import { WorkshopCommands } from './workshop-commands';

function syncFields(target: Y.Map<unknown>, values: Readonly<Record<string, unknown>>): void {
	for (const key of target.keys()) if (!(key in values)) target.delete(key);
	for (const [key, value] of Object.entries(values)) {
		const current = target.get(key);
		if (current instanceof Y.Text && typeof value === 'string') {
			if (current.toJSON() !== value) {
				current.delete(0, current.length);
				current.insert(0, value);
			}
		} else if (current !== value) {
			if (key === 'markdown' && typeof value === 'string') target.set(key, new Y.Text(value));
			else target.set(key, value);
		}
	}
}
function syncCollection(
	document: Y.Doc,
	name: YjsCollection,
	entities: readonly { readonly id: string }[],
): void {
	const target = document.getMap<Y.Map<unknown>>(name);
	const ids = new Set(entities.map(({ id }) => id));
	for (const id of target.keys()) if (!ids.has(id)) target.delete(id);
	for (const entity of entities) {
		const values = Object.fromEntries(
			Object.entries(entity).filter(([key]) => key !== 'id' && key !== 'kind'),
		);
		let map = target.get(entity.id);
		if (map === undefined) {
			map = createYjsEntityMap({});
			target.set(entity.id, map);
		}
		syncFields(map, values);
	}
}

/** Local prototype adapter. Existing commands still run through DocumentSession.
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
		const opened = openDocument(source, () => attachDocumentSession(this.ydoc));
		if (!opened.ok) {
			this.ydoc.destroy();
			throw new Error(opened.diagnostics.map(({ message }) => message).join('; '));
		}
		this.opened = opened.value;
		this.commands = new WorkshopCommands(
			(change) => {
				this.edit(change);
			},
			(relation) => this.opened.addRelation(relation),
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
	/** Read at invocation, validate the complete operation, then commit once. */
	edit(change: (current: LogicDocument) => LogicDocument): void {
		this.apply(change(this.read()));
	}
	apply(next: LogicDocument): void {
		const valid = validateLogicDocument(next);
		if (!valid.ok) throw new Error(valid.diagnostics.map(({ message }) => message).join('; '));
		const graph = createGraph(next);
		if (!graph.ok) throw new Error(graph.diagnostics.map(({ message }) => message).join('; '));
		this.ydoc.transact(() => {
			const meta = this.ydoc.getMap(YjsCollection.Meta);
			for (const [key, value] of Object.entries({
				id: next.id,
				title: next.title,
				layoutDirection: next.layout.direction,
				layoutBias: next.layout.bias,
			}))
				if (meta.get(key) !== value) meta.set(key, value);
			syncCollection(this.ydoc, YjsCollection.Natures, next.natures);
			syncCollection(this.ydoc, YjsCollection.Groups, next.groups);
			syncCollection(this.ydoc, YjsCollection.Nodes, next.nodes);
			syncCollection(this.ydoc, YjsCollection.Junctions, next.junctions);
			syncCollection(this.ydoc, YjsCollection.Relations, next.relations);
		}, this.origin);
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
