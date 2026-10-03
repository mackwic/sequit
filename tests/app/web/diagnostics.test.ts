// @vitest-environment jsdom

import posthog, { type CaptureResult, PostHog } from 'posthog-js';
import { afterEach, expect, it, vi } from 'vitest';

import { initializeAnalytics, setAnalyticsConsent } from '../../../src/app/web/analytics/analytics';
import { initializeDiagnostics } from '../../../src/app/web/analytics/diagnostics';

let diagnostics: PostHog | undefined;

afterEach(async () => {
	await diagnostics?.shutdown();
	await posthog.shutdown();
	vi.unstubAllGlobals();
});

it('keeps diagnostic error collection independent of analytics consent and browser storage', () => {
	window.history.replaceState(null, '', '/session/private-room?email=private@example.test#secret');
	vi.stubGlobal(
		'fetch',
		vi.fn(() => Promise.resolve(new Response('{}'))),
	);
	const config = { key: 'phc_test-public-key', host: '/ingest' };
	initializeAnalytics(config);
	initializeDiagnostics(config, '/session/[room]');
	const instance: unknown = Reflect.get(posthog, 'sequitDiagnostics');
	if (!(instance instanceof PostHog)) throw new Error('Diagnostic instance unavailable');
	diagnostics = instance;
	const events: CaptureResult[] = [];
	const unsubscribe = diagnostics.on('eventCaptured', (event: CaptureResult | null) => {
		if (event !== null) events.push(event);
	});
	diagnostics.captureException(new TypeError('private@example.test secret graph text'));
	setAnalyticsConsent(false);
	diagnostics.captureException(new RangeError('private-room secret token'));

	expect(events.map((event) => event.event)).toEqual(['$exception', '$exception']);
	for (const event of events) {
		expect(event.properties['distinct_id']).not.toBe('$posthog_cookieless');
		expect(event.properties['$session_id']).toEqual(expect.any(String) as unknown);
		expect(event.properties['$geoip_disable']).toBe(true);
	}
	expect(events[0]?.properties['distinct_id']).toBe(events[1]?.properties['distinct_id']);
	const storedKeys = [...Object.keys(localStorage), ...Object.keys(sessionStorage)];
	expect(storedKeys.filter((key) => key.includes('diagnostics'))).toEqual([]);
	expect(document.cookie).not.toContain('ph_');
	const serialized = JSON.stringify(events);
	for (const secret of [
		'private@example.test',
		'private-room',
		'secret graph text',
		'secret token',
	])
		expect(serialized).not.toContain(secret);
	unsubscribe();
});
