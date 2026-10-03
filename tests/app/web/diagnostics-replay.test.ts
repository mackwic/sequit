// @vitest-environment jsdom

import type { CaptureResult } from 'posthog-js';
import { describe, expect, it } from 'vitest';

import {
	createReplayOptions,
	sanitizeReplayEvent,
} from '../../../src/app/web/analytics/diagnostics-replay';

const route = '/notes/[noteId]';
const readRoute = (): string => route;

function element(
	id: number,
	tagName: string,
	attributes: Record<string, unknown>,
	childNodes: unknown[] = [],
	isSVG = false,
): Record<string, unknown> {
	const node = { type: 2, id, tagName, attributes, childNodes };
	if (isSVG) return { ...node, isSVG: true };
	return node;
}

function fullSnapshot(): Record<string, unknown> {
	const box = element(
		4,
		'div',
		{
			class: 'node-card peer-private-name',
			style: 'width:240px;left:12px;background-image:url(https://secret.example/id)',
			'data-node-id': 'node-identifier-secret',
			'data-document-id': 'document-identifier-secret',
			title: 'title-secret',
			'aria-label': 'participant-secret',
		},
		[{ type: 3, id: 5, textContent: 'private document text' }],
	);
	const stylesheet = element(6, 'link', {
		rel: 'stylesheet',
		href: '/_app/immutable/assets/app-CVC123.css',
	});
	const path = element(
		12,
		'path',
		{ d: 'M0 0 L10 10', fill: '#ffffff', stroke: '#222222', 'stroke-width': '2' },
		[],
		true,
	);
	const svg = element(
		11,
		'svg',
		{ viewBox: '0 0 100 100', width: '100', height: '100' },
		[path],
		true,
	);
	const blocked = element(13, 'image', { href: 'data:image/png;base64,image-secret' });
	const body = element(3, 'body', {}, [
		box,
		stylesheet,
		svg,
		blocked,
		element(7, 'img', { src: 'https://secret.example/image' }),
		element(8, 'script', { src: '/secret-script.js' }),
	]);
	const html = element(2, 'html', {}, [body]);
	return {
		type: 2,
		timestamp: 10,
		data: { node: { type: 0, id: 1, childNodes: [html] }, initialOffset: { top: 0, left: 0 } },
	};
}

function mutationEvent(): Record<string, unknown> {
	const attributes = {
		title: 'updated-private-title',
		'aria-label': 'updated-participant',
		href: 'https://private.example/notes/secret?query=hidden',
		'data-node-id': 'updated-id-secret',
		'data-document-id': 'updated-document-secret',
		class: 'node-card private-class-secret',
		style: 'top:20px;background:url(https://private.example/image)',
	};
	const added = element(
		9,
		'div',
		{
			class: 'canvas-lane secret-class',
			style: 'left:31px;color:#abcdef',
			'data-canvas-entity-key': 'entity-secret',
		},
		[{ type: 3, id: 10, textContent: 'new secret node text' }],
	);
	return {
		type: 3,
		timestamp: 11,
		data: {
			source: 0,
			texts: [{ id: 5, value: 'new participant content' }],
			attributes: [{ id: 4, attributes }],
			removes: [],
			adds: [{ parentId: 3, previousId: null, nextId: null, node: added }],
		},
	};
}

function opaqueEvents(): Record<string, unknown>[] {
	return [
		{ type: 5, timestamp: 13, data: { tag: 'custom-plugin', payload: 'opaque-custom-secret' } },
		{ type: 6, timestamp: 14, data: { plugin: 'unknown-plugin', payload: 'opaque-plugin-secret' } },
		{
			type: 3,
			timestamp: 15,
			data: { source: 8, adds: [{ rule: 'body { content: "stylesheet-secret" }' }] },
		},
		{ type: 2, timestamp: 16, cv: '2024-10', data: 'packed-gzip-secret' },
	];
}

function snapshotEvent(): CaptureResult {
	const meta = {
		type: 4,
		timestamp: 12,
		data: {
			href: 'https://app.example/notes/private-note?query-secret#hash-secret',
			width: 1280,
			height: 720,
		},
	};
	return {
		uuid: '00000000-1111-4222-8333-444444444444',
		event: '$snapshot',
		$set: { person_name: 'top-level-person-secret' },
		properties: {
			token: 'phc_public_test_key',
			distinct_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
			$session_id: '11111111-2222-4333-8444-555555555555',
			$window_id: '66666666-7777-4888-8999-aaaaaaaaaaaa',
			$lib: 'web',
			$lib_version: '1.435.7',
			$snapshot_bytes: 500,
			$current_url: 'https://app.example/notes/private-note?secret=query-secret',
			$snapshot_host: 'app.example/private-note',
			$snapshot_data: [fullSnapshot(), mutationEvent(), meta, ...opaqueEvents()],
		},
	};
}

describe('diagnostic replay privacy boundary', () => {
	it('scrubs full snapshots and incremental mutations while preserving replay geometry', () => {
		window.history.replaceState(null, '', '/notes/private-note?query-secret#hash-secret');
		const safe = sanitizeReplayEvent(snapshotEvent(), readRoute);
		expect(safe).not.toBeNull();
		if (safe === null) return;

		const properties = safe.properties;
		expect(properties['$process_person_profile']).toBe(false);
		expect(properties['$session_id']).toBe('11111111-2222-4333-8444-555555555555');
		expect(properties['$window_id']).toBe('66666666-7777-4888-8999-aaaaaaaaaaaa');
		expect(properties['$lib']).toBe('web');
		expect(properties['$lib_version']).toBe('1.435.7');
		expect(properties['$snapshot_data']).toHaveLength(3);

		const serialized = JSON.stringify(properties['$snapshot_data']);
		expect(JSON.stringify(safe)).not.toContain('top-level-person-secret');
		for (const secret of [
			'private document text',
			'new participant content',
			'new secret node text',
			'peer-private-name',
			'node-identifier-secret',
			'document-identifier-secret',
			'title-secret',
			'participant-secret',
			'updated-private-title',
			'updated-participant',
			'updated-id-secret',
			'updated-document-secret',
			'private-class-secret',
			'entity-secret',
			'opaque-custom-secret',
			'opaque-plugin-secret',
			'stylesheet-secret',
			'packed-gzip-secret',
			'private-note',
			'query-secret',
			'hash-secret',
			'https://private.example',
			'image-secret',
		])
			expect(serialized).not.toContain(secret);

		expect(serialized).toContain('xxxxxxxxxxxxxxxxxxxxx');
		expect(serialized).toContain('width:240px;left:12px');
		expect(serialized).toContain('top:20px');
		expect(serialized).toContain('/_app/immutable/assets/app-CVC123.css');
		expect(serialized).toContain(`${window.location.origin}${route}`);
		expect(serialized).toContain('M0 0 L10 10');
		expect(serialized).toContain('#ffffff');
		expect(serialized).not.toContain('background');
	});

	it('keeps exactly the class names the static application stylesheets select', () => {
		window.history.replaceState(null, '', '/notes/private-note');
		const rules = (css: string): CSSRuleList => {
			const style = document.createElement('style');
			style.textContent = css;
			document.head.appendChild(style);
			const sheet = style.sheet;
			style.remove();
			if (sheet === null) throw new Error('Expected a parsed stylesheet');
			return sheet.cssRules;
		};
		Object.defineProperty(document, 'styleSheets', {
			configurable: true,
			value: [
				{
					href: `${window.location.origin}/_app/immutable/assets/app-CVC123.css`,
					cssRules: rules(String.raw`
						.node-card.svelte-19wynar, .canvas-lane > .flex { color: red }
						@media (width < 40rem) { .max-sm\:hidden { display: none } }
						@supports (color: red) { .bg-\[var\(--ui-bg\)\]:hover, .w-1\.5 { color: red } }
					`),
				},
				// Neither inline nor foreign stylesheets are public application build output.
				{ href: null, cssRules: rules('.peer-private-name { color: red }') },
				{
					href: 'https://secret.example/_app/immutable/assets/app.css',
					cssRules: rules('.private-class-secret { color: red }'),
				},
			],
		});
		try {
			const safe = sanitizeReplayEvent(snapshotEvent(), readRoute);
			const serialized = JSON.stringify(safe?.properties['$snapshot_data']);
			expect(serialized).toContain('"class":"node-card"');
			expect(serialized).toContain('"class":"canvas-lane"');
			expect(serialized).not.toContain('peer-private-name');
			expect(serialized).not.toContain('private-class-secret');

			const element = document.createElement('div');
			const masked = createReplayOptions(readRoute).maskAttributeFn?.(
				'class',
				'flex peer-private-name max-sm:hidden bg-[var(--ui-bg)] w-1.5 svelte-19wynar',
				element,
			);
			expect(masked).toBe('flex max-sm:hidden bg-[var(--ui-bg)] w-1.5 svelte-19wynar');
		} finally {
			Reflect.deleteProperty(document, 'styleSheets');
		}
	});

	it('redacts initial network metadata and rejects network content and untemplated routes', () => {
		const options = createReplayOptions(readRoute);
		const maskRequest = options.maskCapturedNetworkRequestFn;
		if (typeof maskRequest !== 'function') throw new Error('Replay URL masker is unavailable');
		// rrweb supplies URL-only metadata despite the SDK's full-request public type.
		const metaUrl: unknown = Reflect.apply(maskRequest, undefined, [
			{ name: 'https://app.example/notes/private-note?email=private@example.test#secret' },
		]);
		if (metaUrl === null || typeof metaUrl !== 'object') {
			throw new Error('Expected masked replay metadata');
		}
		const metaHref: unknown = Reflect.get(metaUrl, 'name');
		expect(metaHref).toBe(`${window.location.origin}${route}`);
		const source = snapshotEvent();
		source.properties['$snapshot_data'] = [
			{ type: 4, timestamp: 12, data: { href: metaHref, width: 1280, height: 720 } },
		];
		expect(sanitizeReplayEvent(source, readRoute)?.properties['$snapshot_data']).toEqual([
			{
				type: 4,
				timestamp: 12,
				data: { href: `${window.location.origin}${route}`, width: 1280, height: 720 },
			},
		]);
		const initial = options.maskCapturedNetworkRequestFn?.({
			name: 'https://app.example/notes/private-note?secret=query-secret',
			duration: 8,
			startTime: 2,
			entryType: 'navigation',
			isInitial: true,
			requestBody: 'request-body-secret',
			responseBody: 'response-body-secret',
			requestHeaders: { authorization: 'header-secret' },
		});
		expect(initial).toMatchObject({
			name: `${window.location.origin}${route}`,
			entryType: 'navigation',
		});
		expect(JSON.stringify(initial)).not.toContain('secret');
		expect(
			options.maskCapturedNetworkRequestFn?.({
				name: 'https://app.example/api/private?secret=query-secret',
				duration: 2,
				startTime: 1,
				entryType: 'fetch',
			}) ?? null,
		).toBeNull();

		const unsafeOptions = createReplayOptions(() => '/notes/private-note?query-secret');
		expect(
			unsafeOptions.maskCapturedNetworkRequestFn?.({
				name: 'https://app.example/notes/private-note',
				duration: 2,
				startTime: 1,
				entryType: 'navigation',
				isInitial: true,
			}) ?? null,
		).toBeNull();
	});

	it('rejects malformed, opaque and out-of-scope snapshots without changing the source', () => {
		const source = snapshotEvent();
		const original = source.properties;
		const malformed: CaptureResult = {
			uuid: source.uuid,
			event: '$snapshot',
			properties: {
				...source.properties,
				$snapshot_data: [{ type: 6, timestamp: 1, data: { plugin: 'unknown', payload: 'opaque' } }],
			},
		};
		expect(sanitizeReplayEvent(malformed, readRoute)).toBeNull();
		expect(source.properties).toBe(original);

		expect(sanitizeReplayEvent(source, () => null)).toBeNull();
		expect(sanitizeReplayEvent(source, () => '/atelier')).toBeNull();
		expect(sanitizeReplayEvent(source, () => '/notes/private?email=secret')).toBeNull();
		const invalidIdentity = {
			...source,
			properties: { ...source.properties, distinct_id: 'private@example.test' },
		};
		expect(sanitizeReplayEvent(invalidIdentity, readRoute)).toBeNull();
		const ordinary: CaptureResult = {
			uuid: source.uuid,
			event: '$exception',
			properties: { secret: 'private' },
		};
		expect(sanitizeReplayEvent(ordinary, readRoute)).toBeNull();
	});
});
