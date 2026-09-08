import type { LogicDocument } from '../../core/document/logic-document';

export enum PendingOperationKind {
	ReplaceNodeMarkdown = 'replace-node-markdown',
}

export interface PendingOperation {
	readonly kind: PendingOperationKind.ReplaceNodeMarkdown;
	readonly nodeId: string;
	readonly markdown: string;
	readonly proposalId?: string;
}

export interface ReplayPartition {
	readonly retained: readonly PendingOperation[];
	readonly dropped: readonly PendingOperation[];
}

export function coalesce(
	queue: readonly PendingOperation[],
	next: PendingOperation,
): readonly PendingOperation[] {
	const trailing = queue.at(-1);
	if (trailing?.kind !== next.kind || trailing.nodeId !== next.nodeId) return [...queue, next];
	return [...queue.slice(0, -1), { kind: next.kind, nodeId: next.nodeId, markdown: next.markdown }];
}

export function retainReplayable(
	queue: readonly PendingOperation[],
	document: LogicDocument,
): ReplayPartition {
	const nodeIds = new Set(document.nodes.map(({ id }) => id));
	const retained: PendingOperation[] = [];
	const dropped: PendingOperation[] = [];
	for (const operation of queue) {
		if (nodeIds.has(operation.nodeId)) retained.push(operation);
		else dropped.push(operation);
	}
	return { retained, dropped };
}
