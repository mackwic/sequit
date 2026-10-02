import type { Handle } from '@sveltejs/kit';

import { paraglideMiddleware } from './app/web/i18n/paraglide/server';

/** Resolve the request locale for server rendering and announce it on `<html lang>`. */
export const handle: Handle = ({ event, resolve }) =>
	paraglideMiddleware(event.request, ({ request, locale }) => {
		event.request = request;
		return resolve(event, {
			transformPageChunk: ({ html }) => html.replace('%lang%', locale),
		});
	});
