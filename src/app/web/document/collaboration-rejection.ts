import type {
	SessionNotice,
	SessionRejection,
} from '../../../lib/infrastructure/collaboration/session-reasons';
import { translateSessionReason } from '../i18n/session-messages';

const ERROR_KEY = 'sequit:collaboration-error';

/** A terminal rejection reloads the page; its translated reason survives for one display. */
export function refreshRejectedSession(reason: SessionRejection | SessionNotice): void {
	try {
		sessionStorage.setItem(ERROR_KEY, translateSessionReason(reason));
	} catch {
		// Without storage the page still recovers; only the explanation is lost.
	}
	window.location.reload();
}

export function consumeCollaborationError(): string | undefined {
	try {
		const message = sessionStorage.getItem(ERROR_KEY);
		if (message === null) return undefined;
		sessionStorage.removeItem(ERROR_KEY);
		return message;
	} catch {
		return undefined;
	}
}
