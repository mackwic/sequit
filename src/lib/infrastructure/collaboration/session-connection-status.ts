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

/** Only an uninitialized (including rejected-and-reset) replica must wait for sync. */
export function textEditable(status: CollaborationStatus, initialized: boolean): boolean {
	return status === CollaborationStatus.Ready || initialized;
}
