import { json, type RequestHandler } from '@sveltejs/kit';

/**
 * In development Vite proxies `/collab` straight to the collaboration worker before SvelteKit sees
 * the request; deployed, the web worker forwards the WebSocket upgrade through its service binding.
 */
export const GET: RequestHandler = ({ request, platform }) => {
	const collaboration = platform?.env.COLLABORATION;
	if (collaboration === undefined)
		return json({ error: 'Collaboration indisponible' }, { status: 503 });
	return collaboration.fetch(request);
};
