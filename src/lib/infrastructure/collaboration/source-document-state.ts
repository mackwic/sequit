import * as Y from 'yjs';

import { compareCanonicalStrings } from '../../core/canonical-string';
import {
	LAYOUT_DIRECTIONS,
	type LayoutDirection,
	type LogicDocument,
} from '../../core/document/logic-document';
import { readLogicDocument } from './yjs-document-codec';
import type { YjsLiveDocumentResult } from './yjs-document-result';
import { YjsCollection } from './yjs-document-schema';

/** A bounded structural view of the current physical Y.Doc, including when it is invalid. */
interface SourceDocumentSnapshot {
	readonly id?: string;
	readonly title?: string;
	readonly layoutDirection?: LayoutDirection;
	readonly natureIds: readonly string[];
	readonly laneIds: readonly string[];
	readonly regionIds: readonly string[];
	readonly groupIds: readonly string[];
	readonly nodeIds: readonly string[];
	readonly junctionIds: readonly string[];
	readonly relationIds: readonly string[];
}

export enum SourceDocumentStateKind {
	Uninitialized = 'uninitialized',
	Valid = 'valid',
	Invalid = 'invalid',
}

interface UninitializedSourceDocumentState {
	readonly kind: SourceDocumentStateKind.Uninitialized;
	readonly revision: number;
}

interface ValidSourceDocumentState {
	readonly kind: SourceDocumentStateKind.Valid;
	readonly document: LogicDocument;
	readonly revision: number;
}

export interface InvalidSourceDocumentState {
	readonly kind: SourceDocumentStateKind.Invalid;
	readonly diagnostics: Extract<YjsLiveDocumentResult<LogicDocument>, { ok: false }>['diagnostics'];
	readonly snapshot: SourceDocumentSnapshot;
	readonly revision: number;
}

export type DecodedSourceDocumentState = ValidSourceDocumentState | InvalidSourceDocumentState;
export type SourceDocumentState = UninitializedSourceDocumentState | DecodedSourceDocumentState;

function safeText(value: unknown): string | undefined {
	if (typeof value === 'string') return value;
	if (value instanceof Y.Text) return value.toJSON();
	return undefined;
}

function collectionIds(document: Y.Doc, collection: YjsCollection): readonly string[] {
	return [...document.getMap(collection).keys()].sort(compareCanonicalStrings);
}

function physicalSourceSnapshot(document: Y.Doc): SourceDocumentSnapshot {
	const meta = document.getMap<unknown>(YjsCollection.Meta);
	const snapshot: {
		id?: string;
		title?: string;
		layoutDirection?: LayoutDirection;
		natureIds: readonly string[];
		laneIds: readonly string[];
		regionIds: readonly string[];
		groupIds: readonly string[];
		nodeIds: readonly string[];
		junctionIds: readonly string[];
		relationIds: readonly string[];
	} = {
		natureIds: collectionIds(document, YjsCollection.Natures),
		laneIds: collectionIds(document, YjsCollection.Lanes),
		regionIds: collectionIds(document, YjsCollection.Regions),
		groupIds: collectionIds(document, YjsCollection.Groups),
		nodeIds: collectionIds(document, YjsCollection.Nodes),
		junctionIds: collectionIds(document, YjsCollection.Junctions),
		relationIds: collectionIds(document, YjsCollection.Relations),
	};
	const id = safeText(meta.get('id'));
	if (id !== undefined) snapshot.id = id;
	const title = safeText(meta.get('title'));
	if (title !== undefined) snapshot.title = title;
	const direction = LAYOUT_DIRECTIONS.find(
		(candidate) => candidate === meta.get('layoutDirection'),
	);
	if (direction !== undefined) snapshot.layoutDirection = direction;
	return snapshot;
}

/** The source state of an already decoded physical Y.Doc, so a transaction is decoded once. */
export function sourceDocumentState(
	document: Y.Doc,
	result: YjsLiveDocumentResult<LogicDocument>,
	revision: number,
): DecodedSourceDocumentState {
	if (result.ok) return { kind: SourceDocumentStateKind.Valid, document: result.value, revision };
	return {
		kind: SourceDocumentStateKind.Invalid,
		diagnostics: result.diagnostics,
		snapshot: physicalSourceSnapshot(document),
		revision,
	};
}

/** Decode the physical Y.Doc once, without substituting a previously accepted document. */
export function readSourceDocumentState(
	document: Y.Doc,
	revision: number,
): DecodedSourceDocumentState {
	return sourceDocumentState(document, readLogicDocument(document), revision);
}

/** Before the first authoritative snapshot arrives, incomplete physical state is not an error. */
export function readSessionSourceState(
	document: Y.Doc,
	previous: SourceDocumentState,
	initialized: boolean,
): SourceDocumentState {
	const revision = previous.revision + 1;
	const decoded = readSourceDocumentState(document, revision);
	if (!initialized && decoded.kind === SourceDocumentStateKind.Invalid)
		return { kind: SourceDocumentStateKind.Uninitialized, revision };
	return decoded;
}
