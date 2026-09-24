import { expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { createSharedCanvasProjection } from '../../../../src/app/web/projection/open-document';
import { SourceDocumentProjectionError } from '../../../../src/app/web/projection/source-document-diagnostic';
import {
	readSourceDocumentState,
	SourceDocumentStateKind,
} from '../../../../src/lib/infrastructure/collaboration/source-document-state';
import { importLogicDocument } from '../../../../src/lib/infrastructure/collaboration/yjs-document-codec';
import {
	createYjsEntityMap,
	YjsCollection,
} from '../../../../src/lib/infrastructure/collaboration/yjs-document-schema';
import { layoutMeasurementsForCanvas } from '../../../support/builders/layout-measurements';
import { validLogicDocument } from '../../../support/builders/logic-document';

it('publishes physical invalid source instead of an accepted scene, rejects stale layout, then recovers', async () => {
	const document = validLogicDocument();
	const ydoc = new Y.Doc();
	importLogicDocument(ydoc, document);
	const projection = createSharedCanvasProjection(document);
	projection.updateSourceState({ kind: SourceDocumentStateKind.Uninitialized, revision: 0 });
	projection.updateSourceState(readSourceDocumentState(ydoc, 1));
	const measurements = layoutMeasurementsForCanvas(projection.measurementModel);
	const before = await projection.createCanvasModel(measurements);
	const subscriber = vi.fn();
	projection.subscribe(subscriber);

	const pending = projection.createCanvasModel(measurements);
	const relations = ydoc.getMap<Y.Map<unknown>>(YjsCollection.Relations);
	relations.set(
		'physical-dangling-relation',
		createYjsEntityMap({ from: 'source-a', to: 'missing-node' }),
	);
	const invalid = readSourceDocumentState(ydoc, 2);
	expect(invalid.kind).toBe(SourceDocumentStateKind.Invalid);
	if (invalid.kind !== SourceDocumentStateKind.Invalid) throw new Error('Expected invalid source');
	projection.updateSourceState(invalid);
	expect(subscriber).toHaveBeenCalledOnce();
	projection.update({
		...document,
		nodes: document.nodes.map((node) => ({ ...node, markdown: 'Must not become visible' })),
	});
	expect(subscriber).toHaveBeenCalledOnce();
	await expect(pending).rejects.toBeInstanceOf(SourceDocumentProjectionError);
	let failure: unknown;
	try {
		await projection.createCanvasModel(measurements);
	} catch (cause) {
		failure = cause;
	}
	expect(failure).toBeInstanceOf(SourceDocumentProjectionError);
	if (!(failure instanceof SourceDocumentProjectionError))
		throw new Error('Expected source diagnostic');
	expect(failure.state.snapshot.relationIds).toContain('physical-dangling-relation');
	expect(failure.state.snapshot.nodeIds).not.toContain('missing-node');
	expect(failure.state.diagnostics[0]?.path).toContain('physical-dangling-relation');

	relations.delete('physical-dangling-relation');
	const healed = readSourceDocumentState(ydoc, 3);
	expect(healed.kind).toBe(SourceDocumentStateKind.Valid);
	projection.updateSourceState(healed);
	expect(subscriber).toHaveBeenCalledTimes(2);
	expect(await projection.createCanvasModel(measurements)).toEqual(before);

	const incomplete = { ...measurements, nodes: new Map(measurements.nodes) };
	incomplete.nodes.delete('source-a');
	const failing = projection.createCanvasModel(incomplete);
	relations.set(
		'physical-dangling-relation',
		createYjsEntityMap({ from: 'source-a', to: 'missing-node' }),
	);
	projection.updateSourceState(readSourceDocumentState(ydoc, 4));
	await expect(failing).rejects.toBeInstanceOf(SourceDocumentProjectionError);
	relations.delete('physical-dangling-relation');
	projection.updateSourceState(readSourceDocumentState(ydoc, 5));
	expect(await projection.createCanvasModel(measurements)).toEqual(before);
	ydoc.destroy();
});
