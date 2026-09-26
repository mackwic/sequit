import { TransportStatus } from './collaboration-transport';
import { CollaborationStatus } from './collaborative-document-session-types';

export function connectionStatus(
	rejected: boolean,
	transport: TransportStatus,
	ready: boolean,
): CollaborationStatus {
	if (rejected || transport === TransportStatus.Disconnected)
		return CollaborationStatus.Disconnected;
	if (transport === TransportStatus.Connecting) return CollaborationStatus.Connecting;
	if (ready) return CollaborationStatus.Ready;
	return CollaborationStatus.Synchronizing;
}

/** Offline editing is opt-in and only possible for an already initialized replica. */
export function textEditable(
	status: CollaborationStatus,
	initialized: boolean,
	offlineTextEditing: boolean,
): boolean {
	if (status === CollaborationStatus.Ready) return true;
	return status === CollaborationStatus.Disconnected && initialized && offlineTextEditing;
}
