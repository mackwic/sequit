import { afterEach, describe, expect, it, vi } from 'vitest';

import { GET, POST } from '../../src/routes/ingest/[...path]/+server';

function invoke(
	path: string,
	method = 'GET',
	headers: Record<string, string> = {},
): Promise<Response> {
	const url = new URL(`https://sequit.test/ingest${path}`);
	const init: RequestInit = { method, headers };
	if (method === 'POST') init.body = '{"event":"$pageview"}';
	const request = new Request(url, init);
	let handler = GET;
	if (method === 'POST') handler = POST;
	return Promise.resolve(Reflect.apply(handler, undefined, [{ request, url }]));
}

afterEach(() => vi.unstubAllGlobals());

describe('same-origin PostHog proxy', () => {
	it('does not disclose browser credentials, IPs or document referrers upstream', async () => {
		let outgoing = new Headers();
		vi.stubGlobal('fetch', (_url: URL, init: RequestInit) => {
			outgoing = new Headers(init.headers);
			return Promise.resolve(
				new Response('ok', {
					headers: { 'set-cookie': 'private=value', 'content-type': 'text/plain' },
				}),
			);
		});
		const response = await invoke('/i/v0/e/?ip=0', 'POST', {
			'content-type': 'application/json',
			cookie: 'session=secret',
			authorization: 'Bearer secret',
			referer: 'https://sequit.test/shared/private-room',
			'x-forwarded-for': '192.0.2.1',
			'cf-connecting-ip': '192.0.2.2',
			'user-agent': 'private-browser',
		});
		expect(Object.fromEntries(outgoing)).toEqual({
			'accept-encoding': 'identity',
			'content-type': 'application/json',
		});
		expect(response.headers.has('set-cookie')).toBe(false);
	});

	it('keeps API and asset requests on fixed EU hosts even with a URL in the query', async () => {
		const destinations: string[] = [];
		vi.stubGlobal('fetch', (url: URL) => {
			destinations.push(url.href);
			return Promise.resolve(new Response('ok'));
		});
		await invoke('/e/?target=https://attacker.test', 'POST');
		await invoke('/static/1.435.7/array.js');
		await invoke('/s/', 'POST');
		await invoke('/i/v1/logs?token=public-project-key', 'POST');
		expect(destinations).toEqual([
			'https://eu.i.posthog.com/e/?target=https://attacker.test',
			'https://eu-assets.i.posthog.com/static/1.435.7/array.js',
			'https://eu.i.posthog.com/s/',
			'https://eu.i.posthog.com/i/v1/logs?token=public-project-key',
		]);
		expect((await invoke('/api/projects/')).status).toBe(404);
		expect((await invoke('//attacker.test/e/')).status).toBe(404);
		expect((await invoke('/%2f%2fattacker.test/e/')).status).toBe(404);
		expect(destinations).toHaveLength(4);
	});

	it('does not follow redirects or expose a cross-domain location to the browser', async () => {
		let redirectPolicy: RequestRedirect | undefined;
		vi.stubGlobal('fetch', (_url: URL, init: RequestInit) => {
			redirectPolicy = init.redirect;
			return Promise.resolve(
				new Response(null, {
					status: 307,
					headers: { location: 'https://attacker.test' },
				}),
			);
		});
		const response = await invoke('/e/', 'POST');
		expect(redirectPolicy).toBe('manual');
		expect(response.status).toBe(502);
		expect(response.headers.has('location')).toBe(false);
	});

	it('preserves upstream refusal and reports an unreachable upstream as a gateway failure', async () => {
		vi.stubGlobal('fetch', () => Promise.resolve(new Response('rate limited', { status: 429 })));
		const refused = await invoke('/e/', 'POST');
		expect(refused.status).toBe(429);
		expect(await refused.text()).toBe('rate limited');
		vi.stubGlobal('fetch', () => Promise.reject(new TypeError('network unavailable')));
		expect((await invoke('/e/', 'POST')).status).toBe(502);
	});
});
