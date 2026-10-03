import type { RequestHandler } from '@sveltejs/kit';

// SDK endpoints use trailing slashes; avoid an extra same-origin redirect for every batch.
export const trailingSlash = 'ignore';

const API_HOST = 'https://eu.i.posthog.com';
const ASSET_HOST = 'https://eu-assets.i.posthog.com';
const API_PATH = /^\/(?:e|s|i\/v0\/e|i\/v1\/logs|batch|flags)\/?$/;
const ASSET_PATH = /^\/(?:static|array)\/[\w./-]+$/;

/** Fixed EU destinations, never a caller-selected URL or an authenticated upstream request. */
const proxy: RequestHandler = async ({ request, url }) => {
	const path = url.pathname.slice('/ingest'.length);
	let host = API_HOST;
	if (ASSET_PATH.test(path)) host = ASSET_HOST;
	else if (!API_PATH.test(path)) return new Response(null, { status: 404 });

	const target = new URL(host);
	target.pathname = path;
	target.search = url.search;
	const headers = new Headers();
	for (const name of ['content-type', 'accept']) {
		const value = request.headers.get(name);
		if (value !== null) headers.set(name, value);
	}
	// Do not disclose visitor IPs, cookies, authentication or document-link referrers.
	headers.set('accept-encoding', 'identity');
	const init: RequestInit & { duplex: 'half' } = {
		method: request.method,
		headers,
		redirect: 'manual',
		duplex: 'half',
	};
	if (request.method === 'POST') init.body = request.body;

	let upstream: Response;
	try {
		upstream = await fetch(target, init);
	} catch {
		return new Response(null, { status: 502 });
	}
	// Never send the browser off-domain, nor follow a redirect to an arbitrary upstream.
	if (upstream.status >= 300 && upstream.status < 400 && upstream.status !== 304)
		return new Response(null, { status: 502 });

	const responseHeaders = new Headers();
	for (const name of ['content-type', 'cache-control', 'etag', 'last-modified']) {
		const value = upstream.headers.get(name);
		if (value !== null) responseHeaders.set(name, value);
	}
	return new Response(upstream.body, {
		status: upstream.status,
		headers: responseHeaders,
	});
};

export const GET: RequestHandler = proxy;
export const POST: RequestHandler = proxy;
