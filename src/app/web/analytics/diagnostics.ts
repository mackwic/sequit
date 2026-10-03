import posthog, { type PostHog } from 'posthog-js';

import { sanitizeDiagnosticEvent, sanitizeDiagnosticLog } from './diagnostics-events';
import { createReplayOptions, sanitizeReplayEvent } from './diagnostics-replay';

interface DiagnosticsConfig {
	key: string;
	host: string;
}

let client: PostHog | undefined;
let currentRoute: string | null = null;
const readRoute = (): string | null => currentRoute;

/** Technical diagnostics have their own ephemeral identity, never the opted-in analytics identity. */
export function initializeDiagnostics(config: DiagnosticsConfig, routeId: string | null): void {
	currentRoute = routeId;
	if (client !== undefined) {
		if (routeId === null) client.stopSessionRecording();
		else client.startSessionRecording();
		return;
	}
	if (routeId === null) return;
	if (typeof window === 'undefined') return;
	if (config.key.trim() === '') return;
	if (config.host.trim() === '') return;

	client = posthog.init(
		config.key,
		{
			api_host: config.host,
			flags_api_host: config.host,
			asset_host: config.host,
			ui_host: 'https://eu.posthog.com',
			api_transport: 'fetch',
			autocapture: false,
			capture_pageview: false,
			capture_pageleave: false,
			capture_heatmaps: false,
			capture_dead_clicks: false,
			capture_performance: false,
			capture_exceptions: { capture_unhandled_errors: true, capture_unhandled_rejections: true },
			disable_session_recording: false,
			enable_recording_console_log: false,
			session_recording: createReplayOptions(readRoute),
			logs: {
				captureConsoleLogs: true,
				serviceName: 'sequit-web',
				beforeSend: (record) => sanitizeDiagnosticLog(record, readRoute),
			},
			disable_surveys: true,
			disable_surveys_automatic_display: true,
			disable_product_tours: true,
			disable_web_experiments: true,
			disable_conversations: true,
			advanced_disable_feature_flags: true,
			advanced_disable_feature_flags_on_first_load: true,
			remote_config_refresh_interval_ms: 0,
			opt_in_site_apps: false,
			persistence: 'memory',
			disable_persistence: true,
			persistence_name: 'sequit-diagnostics',
			consent_persistence_name: 'sequit-diagnostics-consent',
			opt_out_capturing_by_default: false,
			person_profiles: 'never',
			respect_dnt: false,
			ip: false,
			save_referrer: false,
			save_campaign_params: false,
			disable_capture_url_hashes: true,
			disable_scroll_properties: true,
			disableDeviceModel: true,
			before_send: (event) => {
				if (event?.event === '$snapshot') return sanitizeReplayEvent(event, readRoute);
				return sanitizeDiagnosticEvent(event, readRoute);
			},
		},
		'sequitDiagnostics',
	);
}
