import { performance } from 'node:perf_hooks';

import { afterAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { attachDocumentSession } from '../../../../../src/app/web/document/yjs-document-session';
import {
	EndpointKind,
	type LogicDocument,
} from '../../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../../src/lib/core/document/order-key';
import {
	CollaborationStatus,
	createCollaborativeDocumentSession,
} from '../../../../../src/lib/infrastructure/collaboration/collaborative-document-session';
import {
	encodeSessionMessage,
	SessionMessageKind,
} from '../../../../../src/lib/infrastructure/collaboration/session-wire';
import {
	writeSyncRequest,
	writeSyncResponse,
} from '../../../../../src/lib/infrastructure/collaboration/sync-steps';
import { importLogicDocument } from '../../../../../src/lib/infrastructure/collaboration/yjs-document-codec';
import { validLogicDocument } from '../../../../support/builders/logic-document';
import { createMemoryTransportPair } from '../../../../support/harnesses/memory-transport';
import { median } from '../../../../support/performance/performance-statistics';
import {
	type PerformanceMeasurement,
	recordPerformanceMeasurements,
} from '../../../../support/performance/record-performance-measurements';

const LIVE_EDIT_DOCUMENT_SIZE = 3_200;
const WARMUP_RUNS = 3;
const SAMPLE_RUNS = 11;
const LIVE_EDIT_TARGET_MS = 15;

const measurements: PerformanceMeasurement[] = [];

function largeLiveDocument(): LogicDocument {
	const base = validLogicDocument();
	return {
		...base,
		id: 'large-live-edit',
		nodes: [
			...base.nodes,
			...Array.from({ length: LIVE_EDIT_DOCUMENT_SIZE - base.nodes.length }, (_, index) => ({
				kind: EndpointKind.Node as const,
				id: `bulk-${index}`,
				natureId: 'goal',
				markdown: `Bulk node ${index}`,
				layoutOrder: orderKey(`b${index.toString(36)}1`),
			})),
		],
	};
}

function createReadyParticipant(initialDocument: LogicDocument) {
	const transports = createMemoryTransportPair();
	const participant = createCollaborativeDocumentSession(initialDocument, transports.client);
	const serverDocument = new Y.Doc();
	importLogicDocument(serverDocument, initialDocument);
	transports.server.send(
		encodeSessionMessage({
			type: SessionMessageKind.Sync,
			payload: writeSyncResponse(serverDocument),
		}),
	);
	transports.server.send(
		encodeSessionMessage({
			type: SessionMessageKind.Sync,
			payload: writeSyncRequest(serverDocument),
		}),
	);
	return {
		participant,
		destroy: () => {
			participant.destroy();
			serverDocument.destroy();
			transports.server.close();
		},
	};
}

afterAll(() => {
	recordPerformanceMeasurements(measurements);
});

describe('collaborative live-edit performance', { concurrent: false }, () => {
	it('Markdown replacement in a 3,200-node repository document', async () => {
		const document = new Y.Doc();
		importLogicDocument(document, largeLiveDocument());
		const session = attachDocumentSession(document);
		const scenario = 'Markdown replacement in a 3,200-node repository document';
		try {
			for (let index = 0; index < WARMUP_RUNS; index += 1) {
				const warmup = await session.replaceNodeMarkdown('source-a', `repository warmup ${index}`);
				expect(warmup.kind).toBe('accepted');
			}

			const durations: number[] = [];
			for (let index = 0; index < SAMPLE_RUNS; index += 1) {
				const started = performance.now();
				const outcome = await session.replaceNodeMarkdown('source-a', `repository sample ${index}`);
				durations.push(performance.now() - started);
				expect(outcome.kind).toBe('accepted');
			}
			const observedMs = median(durations);
			measurements.push({
				scenario,
				size: LIVE_EDIT_DOCUMENT_SIZE,
				metric: 'medianMs',
				observedMs,
				budgetMs: LIVE_EDIT_TARGET_MS,
				details: { warmupRuns: WARMUP_RUNS, samples: durations },
			});
			process.stderr.write(
				`Repository Markdown edits: ${LIVE_EDIT_DOCUMENT_SIZE} nodes, ${observedMs.toFixed(2)} ms median; target ~${LIVE_EDIT_TARGET_MS} ms\n`,
			);
		} finally {
			session.destroy();
			document.destroy();
		}
	}, 120_000);

	it('Markdown replacement through a ready local participant', () => {
		const initialDocument = largeLiveDocument();
		const { participant, destroy } = createReadyParticipant(initialDocument);
		const scenario = 'Markdown replacement through a ready local participant';
		try {
			expect(participant.connectionStatus()).toBe(CollaborationStatus.Ready);
			for (let index = 0; index < WARMUP_RUNS; index += 1)
				expect(participant.replaceNodeMarkdown('source-a', `participant warmup ${index}`)).toBe(
					true,
				);

			const durations: number[] = [];
			for (let index = 0; index < SAMPLE_RUNS; index += 1) {
				const started = performance.now();
				const updated = participant.replaceNodeMarkdown('source-a', `participant sample ${index}`);
				durations.push(performance.now() - started);
				expect(updated).toBe(true);
			}
			const observedMs = median(durations);
			measurements.push({
				scenario,
				size: LIVE_EDIT_DOCUMENT_SIZE,
				metric: 'medianMs',
				observedMs,
				budgetMs: LIVE_EDIT_TARGET_MS,
				details: {
					warmupRuns: WARMUP_RUNS,
					samples: durations,
					path: 'CollaborativeSession.replaceNodeMarkdown -> TextUpdateBuffer.push + readSourceDocumentState',
					budgetScope: 'local web session; worker authorization and persistence excluded',
					transportLatencyIncluded: false,
				},
			});
			process.stderr.write(
				`Participant Markdown edits: ${LIVE_EDIT_DOCUMENT_SIZE} nodes, ${observedMs.toFixed(2)} ms median; target ~${LIVE_EDIT_TARGET_MS} ms\n`,
			);
		} finally {
			destroy();
		}
	}, 120_000);
});
