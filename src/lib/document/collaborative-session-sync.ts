import * as Y from 'yjs';

import type { SyncResponseMessage } from '../collaboration/protocol';
import {
	applyAuthoritativeUpdate,
	cloneCollaborativeYDoc,
	isValidEmptyRoomUpdate,
} from './collaborative-session-documents';
import { type SessionPhase, SessionPhaseKind } from './collaborative-session-model';

export enum SyncResolutionKind {
	Ignore = 'ignore',
	Initialize = 'initialize',
	Repair = 'repair',
	Accept = 'accept',
}

interface IgnoreSyncResolution {
	readonly kind: SyncResolutionKind.Ignore;
}

interface InitializeSyncResolution {
	readonly kind: SyncResolutionKind.Initialize;
}

interface RepairSyncResolution {
	readonly kind: SyncResolutionKind.Repair;
}

interface AcceptedSyncResolution {
	readonly kind: SyncResolutionKind.Accept;
	readonly document: Y.Doc;
	readonly commit: number;
}

export type SyncResolution =
	IgnoreSyncResolution | InitializeSyncResolution | RepairSyncResolution | AcceptedSyncResolution;

export function resolveSyncResponse(
	phase: SessionPhase,
	accepted: Y.Doc,
	lastCommit: number,
	message: SyncResponseMessage,
): SyncResolution {
	const firstOrFullSync =
		phase.kind === SessionPhaseKind.FirstSync || phase.kind === SessionPhaseKind.FullResync;
	const roomHasNoCommit = lastCommit === 0 && message.commit === 0;
	if (firstOrFullSync && roomHasNoCommit) {
		if (isValidEmptyRoomUpdate(message)) return { kind: SyncResolutionKind.Initialize };
		return { kind: SyncResolutionKind.Repair };
	}
	if (phase.kind === SessionPhaseKind.IncrementalResync) {
		if (message.commit < lastCommit) return { kind: SyncResolutionKind.Repair };
		const document = applyAuthoritativeUpdate(cloneCollaborativeYDoc(accepted), message);
		if (document === undefined) return { kind: SyncResolutionKind.Repair };
		return { kind: SyncResolutionKind.Accept, document, commit: message.commit };
	}
	const acceptsFullSync =
		phase.kind === SessionPhaseKind.FirstSync || phase.kind === SessionPhaseKind.FullResync;
	if (!acceptsFullSync) return { kind: SyncResolutionKind.Ignore };
	const document = applyAuthoritativeUpdate(new Y.Doc(), message);
	if (document === undefined) return { kind: SyncResolutionKind.Repair };
	return { kind: SyncResolutionKind.Accept, document, commit: message.commit };
}
