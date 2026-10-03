import type { CapturedNetworkRequest, CaptureResult, SessionRecordingOptions } from 'posthog-js';

import {
	plainArray,
	plainRecord,
	safeRoute,
	safeTimestamp,
	safeToken,
	safeUuid,
} from './diagnostics-data';
import { rrwebAttribute } from './diagnostics-replay-attributes';
import { replayEvent } from './diagnostics-replay-events';
import { mask, number, replayUrl } from './diagnostics-replay-values';

const SAFE_VERSION = /^\d+\.\d+\.\d+$/;

function safeString(value: unknown, pattern: RegExp): string | undefined {
	if (typeof value !== 'string') return undefined;
	if (!pattern.test(value)) return undefined;
	return value;
}
function copyIds(input: Record<string, unknown>, output: Record<string, unknown>): boolean {
	const token = input['token'];
	const distinct = input['distinct_id'];
	const session = input['$session_id'];
	const windowId = input['$window_id'];
	if (!safeToken(token) || !safeUuid(distinct)) return false;
	if (!safeUuid(session) || !safeUuid(windowId)) return false;
	output['token'] = token;
	output['distinct_id'] = distinct;
	output['$session_id'] = session;
	output['$window_id'] = windowId;
	return true;
}
function snapshotProperties(
	value: unknown,
	readRoute: () => string | null,
): Record<string, unknown> | null {
	if (!plainRecord(value) || !plainArray(value['$snapshot_data'])) return null;
	const events = value['$snapshot_data']
		.map((item) => replayEvent(item, readRoute))
		.filter(plainRecord);
	if (events.length === 0) return null;
	const output: Record<string, unknown> = {
		$snapshot_data: events,
		$process_person_profile: false,
		$geoip_disable: true,
	};
	if (!copyIds(value, output)) return null;
	let lib: string | undefined;
	if (value['$lib'] === 'web') lib = 'web';
	const version = safeString(value['$lib_version'], SAFE_VERSION);
	if (lib !== undefined) output['$lib'] = lib;
	if (version !== undefined) output['$lib_version'] = version;
	const bytes = number(value['$snapshot_bytes']);
	if (bytes !== undefined && bytes >= 0) output['$snapshot_bytes'] = bytes;
	return output;
}
function networkRequest(
	request: Partial<CapturedNetworkRequest>,
	readRoute: () => string | null,
): CapturedNetworkRequest | null {
	// rrweb Meta URL masking invokes this callback with only { name }.
	if (request.isInitial !== true && request.entryType !== undefined) return null;
	const name = replayUrl(readRoute);
	if (name === null) return null;
	const duration = number(request.duration) ?? 0;
	const startTime = number(request.startTime) ?? 0;
	return { name, duration, startTime, entryType: 'navigation', isInitial: true };
}

/** Builds privacy-first rrweb options for the diagnostics PostHog instance. */
export function createReplayOptions(readRoute: () => string | null): SessionRecordingOptions {
	return {
		blockSelector:
			'img, picture, video, audio, iframe, object, embed, canvas, svg image, input, textarea, select, option, [contenteditable], script',
		maskAllInputs: true,
		maskInputFn: mask,
		maskTextSelector: '*',
		maskTextFn: mask,
		maskAttributeFn: (name, value, element) => rrwebAttribute(name, value, element),
		maskCapturedNetworkRequestFn: (request) => networkRequest(request, readRoute),
		captureJsonLd: false,
		collectFonts: false,
		inlineStylesheet: false,
		recordCrossOriginIframes: false,
		recordHeaders: false,
		recordBody: false,
		compress_events: false,
		captureCanvas: { recordCanvas: false },
	};
}

/** Rebuilds only inspectable replay payloads on an approved route, dropping unknown data. */
export function sanitizeReplayEvent(
	event: CaptureResult | null,
	readRoute: () => string | null,
): CaptureResult | null {
	try {
		if (event?.event !== '$snapshot') return null;
		const uuid = event.uuid;
		if (!safeUuid(uuid)) return null;
		if (safeRoute(readRoute) === null) return null;
		const safe = snapshotProperties(event.properties, readRoute);
		if (safe === null) return null;
		const sanitized: CaptureResult = { uuid, event: '$snapshot', properties: safe };
		const timestamp = safeTimestamp(event.timestamp);
		if (timestamp !== undefined) sanitized.timestamp = timestamp;
		return sanitized;
	} catch {
		return null;
	}
}
