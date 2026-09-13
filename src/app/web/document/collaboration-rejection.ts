import { replaceState } from '$app/navigation';
import { resolve } from '$app/paths';
import type { Pathname } from '$app/types';

const ERROR_PARAMETER = 'collaboration-error';

export function refreshRejectedSession(message: string): void {
	const url = new URL(window.location.href);
	url.searchParams.set(ERROR_PARAMETER, message);
	window.location.replace(url.href);
}

export function consumeCollaborationError(path: Pathname): string | undefined {
	const url = new URL(window.location.href);
	const message = url.searchParams.get(ERROR_PARAMETER);
	if (message === null) return undefined;
	url.searchParams.delete(ERROR_PARAMETER);
	replaceState(resolve(`${path}?${url.searchParams.toString()}${url.hash}`), {});
	return message;
}
