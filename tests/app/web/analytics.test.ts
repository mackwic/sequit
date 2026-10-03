// @vitest-environment jsdom

import posthog, { type CaptureResult } from 'posthog-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
	captureAnalyticsPageview,
	initializeAnalytics,
	readAnalyticsConsent,
	setAnalyticsConsent,
} from '../../../src/app/web/analytics/analytics';

afterEach(async () => {
	await posthog.shutdown();
	vi.unstubAllGlobals();
});

describe('analytics privacy boundary', () => {
	it('sends only anonymized route-template pageviews through consent transitions', () => {
		window.history.replaceState(null, '', '/notes/private-note?query-secret#fragment-secret');
		Object.defineProperty(document, 'referrer', {
			configurable: true,
			value: 'https://private-referrer.example/private-referrer-path?referrer-secret',
		});
		document.title = 'private-document-title';
		vi.stubGlobal(
			'fetch',
			vi.fn(() => Promise.resolve(new Response('{}', { status: 200 }))),
		);

		initializeAnalytics({ key: 'phc_test-public-key', host: '/ingest' });
		const expectedUrl = `${window.location.origin}/notes/[noteId]`;
		expect(readAnalyticsConsent()).toBeUndefined();

		const events: CaptureResult[] = [];
		const unsubscribe = posthog.on('eventCaptured', (event: CaptureResult | null) => {
			if (event !== null) events.push(event);
		});

		captureAnalyticsPageview('/notes/[noteId]');
		expect(events).toHaveLength(1);
		expect(events[0]?.event).toBe('$pageview');
		expect(events[0]?.properties).toEqual({
			token: 'phc_test-public-key',
			distinct_id: expect.any(String) as unknown,
			$geoip_disable: true,
			$current_url: expectedUrl,
			$pathname: '/notes/[noteId]',
			$cookieless_mode: true,
		});

		setAnalyticsConsent(true);
		expect(readAnalyticsConsent()).toBe(true);
		expect(window.localStorage.getItem('sequit-analytics-consent')).toBe('1');
		posthog.capture('$pageview', { custom_secret: 'private-custom-property' });
		expect(events).toHaveLength(2);
		expect(events[1]?.properties).toEqual({
			token: 'phc_test-public-key',
			distinct_id: expect.any(String) as unknown,
			$geoip_disable: true,
			$current_url: expectedUrl,
			$pathname: '/notes/[noteId]',
		});
		expect(events[1]?.properties['distinct_id']).not.toBe('$posthog_cookieless');
		Object.defineProperty(window.navigator, 'globalPrivacyControl', {
			configurable: true,
			value: true,
		});
		expect(readAnalyticsConsent()).toBe(false);
		Object.defineProperty(window.navigator, 'globalPrivacyControl', {
			configurable: true,
			value: false,
		});
		expect(readAnalyticsConsent()).toBe(true);

		captureAnalyticsPageview('/atelier/reports');
		captureAnalyticsPageview(null);
		posthog.capture('private-custom-event', { private_data: 'private-custom-event-data' });
		expect(events).toHaveLength(2);

		setAnalyticsConsent(false);
		expect(readAnalyticsConsent()).toBe(false);
		expect(window.localStorage.getItem('sequit-analytics-consent')).toBe('0');
		captureAnalyticsPageview('/notes/[noteId]');
		expect(events).toHaveLength(3);
		expect(events[2]?.properties['$cookieless_mode']).toBe(true);
		expect(events[2]?.properties['distinct_id']).not.toBe(events[1]?.properties['distinct_id']);

		const serialized = JSON.stringify(events);
		for (const secret of [
			'notes/private-note',
			'query-secret',
			'fragment-secret',
			'private-referrer',
			'referrer-secret',
			'private-document-title',
			'private-custom-property',
			'private-custom-event-data',
		])
			expect(serialized).not.toContain(secret);

		unsubscribe();
	});
});
