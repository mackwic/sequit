import type { CaptureLogOptions, CaptureResult } from 'posthog-js';
import { describe, expect, it } from 'vitest';

import {
	sanitizeDiagnosticEvent,
	sanitizeDiagnosticLog,
} from '../../../src/app/web/analytics/diagnostics-events';

const EVENT_ID = '00000000-0000-4000-8000-000000000001';
const SESSION_ID = '00000000-0000-4000-8000-000000000002';
const WINDOW_ID = '00000000-0000-4000-8000-000000000003';
const DISTINCT_ID = '00000000-0000-4000-8000-000000000004';
const ROUTE = '/notes/[noteId]';

describe('diagnostic privacy boundary', () => {
	it('redacts log bodies and removes every user attribute while overriding SDK url enrichment', () => {
		const record: CaptureLogOptions = {
			body: 'alice@example.com token=secret-123 private-document-title',
			level: 'warn',
			trace_id: 'trace-private-id',
			span_id: 'span-private-id',
			trace_flags: 1,
			attributes: {
				'url.full': 'https://alice:pw@example.com/notes/private-id?token=secret#hash',
				user_email: 'alice@example.com',
				nested: { token: 'secret-123', message: 'private body' },
			},
		};

		const sanitized = sanitizeDiagnosticLog(record, () => ROUTE);

		expect(sanitized).toEqual({
			body: '[redacted]',
			level: 'warn',
			attributes: { 'url.full': ROUTE },
		});
		expect(JSON.stringify(sanitized)).not.toContain('alice@example.com');
		expect(JSON.stringify(sanitized)).not.toContain('secret-123');
	});

	it('keeps only safe exception types, app frames, positions, ephemeral ids and a route template', () => {
		const event: CaptureResult = {
			event: '$exception',
			uuid: EVENT_ID,
			properties: {
				$session_id: SESSION_ID,
				$window_id: WINDOW_ID,
				token: 'phc_test-public-key',
				distinct_id: DISTINCT_ID,
				$exception_level: 'error',
				$exception_message: 'alice@example.com token=secret-123',
				$exception_list: [
					{
						type: 'TypeError',
						value: 'Cannot load private-document-title for alice@example.com',
						stacktrace: {
							type: 'raw',
							frames: [
								{
									filename: 'https://app.example/_app/immutable/nodes/3.C2x.js',
									lineno: 41,
									colno: 7,
									function: 'savePrivateDocument',
									module: 'user-private-module',
									context_line: 'secret source line',
									vars: { token: 'secret-123' },
								},
								{
									filename: '/src/app/web/save.ts?email=alice@example.com',
									lineno: 55,
									colno: 2,
								},
								{
									filename: 'https://app.example/users/alice/profile.js',
									lineno: 8,
									colno: 3,
								},
								{
									filename: '/src/app/web/app.ts',
									lineno: 12,
									colno: 4,
								},
							],
						},
					},
					{
						type: 'UnhandledRejection',
						value: 'Rejected promise included private details',
					},
				],
				$sentry_exception: { message: 'private nested exception' },
				custom: 'unapproved-property',
			},
		};

		const sanitized = sanitizeDiagnosticEvent(event, () => ROUTE);
		expect(sanitized?.event).toBe('$exception');
		expect(sanitized?.properties).toEqual({
			$exception_list: [
				{
					type: 'TypeError',
					value: '[redacted]',
					stacktrace: {
						type: 'raw',
						frames: [
							{
								filename: '/_app/immutable/nodes/3.C2x.js',
								abs_path: '/_app/immutable/nodes/3.C2x.js',
								platform: 'web:javascript',
								in_app: true,
								lineno: 41,
								colno: 7,
							},
							{
								filename: '/src/app/web/app.ts',
								abs_path: '/src/app/web/app.ts',
								platform: 'web:javascript',
								in_app: true,
								lineno: 12,
								colno: 4,
							},
						],
					},
				},
				{ type: 'UnhandledRejection', value: '[redacted]' },
			],
			$exception_type: 'TypeError',
			$exception_message: '[redacted]',
			$exception_level: 'error',
			$session_id: SESSION_ID,
			$window_id: WINDOW_ID,
			token: 'phc_test-public-key',
			distinct_id: DISTINCT_ID,
			$geoip_disable: true,
			$process_person_profile: false,
			$current_url: ROUTE,
			$pathname: ROUTE,
		});
		const serialized = JSON.stringify(sanitized);
		for (const secret of [
			'alice@example.com',
			'secret-123',
			'private-document-title',
			'user-private-module',
		]) {
			expect(serialized).not.toContain(secret);
		}
	});
	it('requires the public project token and ephemeral distinct id for routing', () => {
		const properties = {
			token: 'phc_test-public-key',
			distinct_id: DISTINCT_ID,
			$session_id: SESSION_ID,
			$window_id: WINDOW_ID,
			$exception_list: [{ type: 'Error', value: 'private message' }],
		};
		const event: CaptureResult = { event: '$exception', uuid: EVENT_ID, properties };
		const missingToken = { ...event, properties: { ...properties, token: undefined } };
		const invalidDistinctId = {
			...event,
			properties: { ...properties, distinct_id: 'alice@example.com' },
		};

		expect(sanitizeDiagnosticEvent(event, () => ROUTE)?.properties).toMatchObject({
			token: 'phc_test-public-key',
			distinct_id: DISTINCT_ID,
		});
		expect(sanitizeDiagnosticEvent(missingToken, () => ROUTE)).toBeNull();
		expect(sanitizeDiagnosticEvent(invalidDistinctId, () => ROUTE)).toBeNull();
	});

	it('drops diagnostics when the route is missing or unsafe', () => {
		const event: CaptureResult = {
			event: '$exception',
			uuid: EVENT_ID,
			properties: {
				token: 'phc_test-public-key',
				distinct_id: DISTINCT_ID,
				$session_id: SESSION_ID,
				$window_id: WINDOW_ID,
				$exception_list: [{ type: 'Error', value: 'message' }],
			},
		};
		const log: CaptureLogOptions = { body: 'private log', level: 'error' };

		expect(sanitizeDiagnosticEvent(event, () => null)).toBeNull();
		expect(sanitizeDiagnosticEvent(event, () => '/notes/alice?email=alice@example.com')).toBeNull();
		expect(sanitizeDiagnosticLog(log, () => null)).toBeNull();
	});

	it('fails closed on malformed ids, custom prototypes and accessor-bearing records', () => {
		const event: CaptureResult = {
			event: '$exception',
			uuid: EVENT_ID,
			properties: {
				token: 'phc_test-public-key',
				distinct_id: DISTINCT_ID,
				$session_id: 'alice@example.com',
				$window_id: WINDOW_ID,
				$exception_list: [{ type: 'Error', value: 'private message' }],
			},
		};
		const getterProperties: unknown = Object.create({
			get $session_id() {
				throw new Error('private getter detail');
			},
		});
		const accessorProperties = {};
		Object.defineProperty(accessorProperties, '$exception_list', {
			get() {
				throw new Error('private getter detail');
			},
		});
		const customEvent: CaptureResult = { ...event };
		Reflect.set(customEvent, 'properties', getterProperties);
		const accessorEvent: CaptureResult = { ...event, properties: accessorProperties };
		const specialLog: CaptureLogOptions = { body: 'private log' };
		Reflect.set(specialLog, 'attributes', new Date());

		expect(sanitizeDiagnosticEvent(event, () => ROUTE)).toBeNull();
		expect(sanitizeDiagnosticEvent(customEvent, () => ROUTE)).toBeNull();
		expect(sanitizeDiagnosticEvent(accessorEvent, () => ROUTE)).toBeNull();
		expect(sanitizeDiagnosticLog(specialLog, () => ROUTE)).toBeNull();
	});
});
