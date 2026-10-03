import type { CaptureLogOptions, CaptureResult } from 'posthog-js';

import {
	ownValue,
	plainRecord,
	REDACTED,
	safeRoute,
	safeTimestamp,
	safeToken,
	safeUuid,
} from './diagnostics-data';
import { safeExceptionLevel, sanitizeExceptionList } from './diagnostics-exceptions';

const SAFE_LOG_LEVELS: Record<string, CaptureLogOptions['level']> = {
	trace: 'trace',
	debug: 'debug',
	info: 'info',
	warn: 'warn',
	error: 'error',
	fatal: 'fatal',
};

function safeSessionId(value: unknown): string | undefined {
	if (!safeUuid(value)) return undefined;
	return value;
}

function sanitizeExceptionEvent(
	event: unknown,
	readRoute: () => string | null,
): CaptureResult | null {
	if (!plainRecord(event) || ownValue(event, 'event') !== '$exception') return null;
	const uuid = ownValue(event, 'uuid');
	const rawProperties: unknown = ownValue(event, 'properties');
	if (!safeUuid(uuid) || !plainRecord(rawProperties)) return null;
	const exceptions = sanitizeExceptionList(ownValue(rawProperties, '$exception_list'));
	if (exceptions === null) return null;
	const route = safeRoute(readRoute);
	const properties = buildExceptionProperties(rawProperties, exceptions, route);
	if (properties === null) return null;
	const timestamp = safeTimestamp(ownValue(event, 'timestamp'));
	const sanitized: CaptureResult = { event: '$exception', uuid, properties };
	if (timestamp !== undefined) sanitized.timestamp = timestamp;
	return sanitized;
}

function buildExceptionProperties(
	properties: Record<string, unknown>,
	exceptions: Record<string, unknown>[],
	route: string | null,
): CaptureResult['properties'] | null {
	const sessionId = safeSessionId(ownValue(properties, '$session_id'));
	const windowId = safeSessionId(ownValue(properties, '$window_id'));
	if (sessionId === undefined) return null;
	if (windowId === undefined || route === null) return null;
	const token = ownValue(properties, 'token');
	const distinctId = safeSessionId(ownValue(properties, 'distinct_id'));
	if (!safeToken(token) || distinctId === undefined) return null;
	return {
		token,
		distinct_id: distinctId,
		$exception_list: exceptions,
		$exception_type: exceptions[0]?.['type'],
		$exception_message: REDACTED,
		$exception_level: safeExceptionLevel(ownValue(properties, '$exception_level')),
		$session_id: sessionId,
		$window_id: windowId,
		$geoip_disable: true,
		$process_person_profile: false,
		$current_url: route,
		$pathname: route,
	};
}

function sanitizeEventSafely(
	event: CaptureResult | null,
	readRoute: () => string | null,
): CaptureResult | null {
	if (event === null) return null;
	try {
		return sanitizeExceptionEvent(event, readRoute);
	} catch {
		return null;
	}
}

function safeLogLevel(value: unknown): NonNullable<CaptureLogOptions['level']> {
	if (typeof value !== 'string') return 'info';
	if (!Object.hasOwn(SAFE_LOG_LEVELS, value)) return 'info';
	return SAFE_LOG_LEVELS[value] ?? 'info';
}

function sanitizeLogSafely(
	record: CaptureLogOptions,
	readRoute: () => string | null,
): CaptureLogOptions | null {
	try {
		if (!plainRecord(record)) return null;
		if (typeof ownValue(record, 'body') !== 'string') return null;
		const attributes: unknown = ownValue(record, 'attributes');
		if (attributes !== undefined && !plainRecord(attributes)) return null;
		const route = safeRoute(readRoute);
		if (route === null) return null;
		return {
			body: REDACTED,
			level: safeLogLevel(ownValue(record, 'level')),
			attributes: { 'url.full': route },
		};
	} catch {
		return null;
	}
}

export function sanitizeDiagnosticEvent(
	event: CaptureResult | null,
	readRoute: () => string | null,
): CaptureResult | null {
	return sanitizeEventSafely(event, readRoute);
}

export function sanitizeDiagnosticLog(
	record: CaptureLogOptions,
	readRoute: () => string | null,
): CaptureLogOptions | null {
	return sanitizeLogSafely(record, readRoute);
}
