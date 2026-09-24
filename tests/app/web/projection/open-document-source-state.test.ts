import { expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { attachDocumentSession } from '../../../../src/app/web/document/yjs-document-session';
import { openDocument } from '../../../../src/app/web/projection/open-document';
import { SourceDocumentProjectionError } from '../../../../src/app/web/projection/source-document-diagnostic';
import { SourceDocumentStateKind } from '../../../../src/lib/infrastructure/collaboration/source-document-state';
import { importLogicDocument } from '../../../../src/lib/infrastructure/collaboration/yjs-document-codec';
import {
	createYjsEntityMap,
	YjsCollection,
} from '../../../../src/lib/infrastructure/collaboration/yjs-document-schema';
import { parseSequitToml } from '../../../../src/lib/infrastructure/toml/parse-sequit-toml';
import { layoutMeasurementsForCanvas } from '../../../support/builders/layout-measurements';
import { aiDocumentaryEffortScenario } from '../../../support/scenarios/ai-documentary-effort';

it('notifies the canvas of a physical invalid snapshot, then renders again after healing', async () => {
	const source = await aiDocumentaryEffortScenario();
	const parsed = parseSequitToml(source);
	if (!parsed.ok) throw new Error('Reference document must parse');
	const ydoc = new Y.Doc();
	importLogicDocument(ydoc, parsed.value);
	const result = openDocument(source, () => attachDocumentSession(ydoc));
	if (!result.ok) throw new Error('Reference document must open');
	const opened = result.value;
	const accepted = opened.read();
	const measurements = layoutMeasurementsForCanvas(opened.measurementModel);
	const before = await opened.createCanvasModel(measurements);
	const subscriber = vi.fn();
	opened.subscribe(subscriber);
	const relations = ydoc.getMap<Y.Map<unknown>>(YjsCollection.Relations);
	const invalidRelationId = 'physical-dangling-relation';
	const pending = opened.createCanvasModel(measurements);

	relations.set(
		invalidRelationId,
		createYjsEntityMap({ from: 'traceable-edits', to: 'missing-physical-node' }),
	);

	expect(subscriber).toHaveBeenCalledOnce();
	await expect(pending).rejects.toBeInstanceOf(SourceDocumentProjectionError);
	expect(opened.read()).toBe(accepted);
	expect(opened.measurementModel).toBeDefined();
	let failure: unknown;
	try {
		await opened.createCanvasModel(measurements);
	} catch (error) {
		failure = error;
	}
	expect(failure).toBeInstanceOf(SourceDocumentProjectionError);
	if (!(failure instanceof SourceDocumentProjectionError))
		throw new Error('Expected source document diagnostic');
	expect(failure.state.kind).toBe(SourceDocumentStateKind.Invalid);
	expect(failure.state.revision).toBe(1);
	expect(failure.state.snapshot.relationIds).toContain(invalidRelationId);
	expect(failure.state.snapshot.nodeIds).not.toContain('missing-physical-node');
	expect(accepted.relations.map(({ id }) => id)).not.toContain(invalidRelationId);
	expect(failure.state.diagnostics[0]?.path).toContain(invalidRelationId);

	relations.delete(invalidRelationId);

	expect(subscriber).toHaveBeenCalledTimes(2);
	const after = await opened.createCanvasModel(measurements);
	expect(after).toEqual(before);

	const incomplete = { ...measurements, nodes: new Map(measurements.nodes) };
	incomplete.nodes.delete('traceable-edits');
	const failing = opened.createCanvasModel(incomplete);
	relations.set(
		invalidRelationId,
		createYjsEntityMap({ from: 'traceable-edits', to: 'missing-physical-node' }),
	);
	await expect(failing).rejects.toBeInstanceOf(SourceDocumentProjectionError);
	relations.delete(invalidRelationId);
	expect(await opened.createCanvasModel(measurements)).toEqual(before);
	opened.destroy();
	ydoc.destroy();
});
