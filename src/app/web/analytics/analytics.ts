import posthog, { type CaptureResult } from 'posthog-js';

const ANALYTICS_CONSENT_KEY = 'sequit-analytics-consent';

interface AnalyticsConfig {
	key: string;
	host: string;
}

interface SafeRoute {
	pathname: string;
	currentUrl: string;
}

let initialized = false;
let activeRoute: SafeRoute | undefined;

function privacySignalIsEnabled(): boolean {
	if (typeof window === 'undefined') return false;
	const navigator = window.navigator as Navigator & {
		globalPrivacyControl?: boolean;
		msDoNotTrack?: string;
	};
	const browserWindow = window as Window & { doNotTrack?: string };
	return [
		navigator.doNotTrack,
		navigator.msDoNotTrack,
		browserWindow.doNotTrack,
		navigator.globalPrivacyControl,
	].some((value) => {
		const normalized = String(value).toLowerCase();
		return /^(1|true|yes)$/.test(normalized);
	});
}

function localStorageOrUndefined(): Storage | undefined {
	if (typeof window === 'undefined') return undefined;
	try {
		return window.localStorage;
	} catch {
		return undefined;
	}
}

function beforeSend(event: CaptureResult | null): CaptureResult | null {
	const route = activeRoute;
	if (event?.event !== '$pageview') return null;
	if (route === undefined) return null;

	const token: unknown = event.properties['token'];
	const distinctId: unknown = event.properties['distinct_id'];
	if (typeof token !== 'string') return null;
	const idType = typeof distinctId;
	const validId = idType === 'string' || idType === 'number';
	if (!validId) return null;

	const properties: CaptureResult['properties'] = {
		token,
		distinct_id: distinctId,
		$geoip_disable: true,
		$current_url: route.currentUrl,
		$pathname: route.pathname,
	};
	if (event.properties['$cookieless_mode'] === true) properties['$cookieless_mode'] = true;
	const sanitized: CaptureResult = { event: '$pageview', uuid: event.uuid, properties };
	if (event.timestamp !== undefined) sanitized.timestamp = event.timestamp;
	return sanitized;
}

function safeRoute(routeId: string | null): SafeRoute | undefined {
	if (routeId === null) return undefined;
	if (!/^\/[\w/()[\].=-]*$/u.test(routeId)) return undefined;
	if (routeId.startsWith('//')) return undefined;
	if (routeId.split('/').some((segment) => segment === '.' || segment === '..')) return undefined;

	const segments = routeId
		.split('/')
		.filter((segment) => !(segment.startsWith('(') && segment.endsWith(')')));
	if (segments.includes('atelier')) return undefined;

	const origin = window.location.origin;
	let currentUrl = routeId;
	if (origin !== 'null') currentUrl = `${origin}${routeId}`;
	return {
		pathname: routeId,
		currentUrl,
	};
}

/** Initializes the pageview-only analytics client once, in the browser. */
export function initializeAnalytics(config: AnalyticsConfig): void {
	if (initialized) return;
	if (typeof window === 'undefined') return;
	if (config.key.trim() === '') return;
	if (config.host.trim() === '') return;

	posthog.init(config.key, {
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
		capture_exceptions: false,
		capture_performance: false,
		disable_session_recording: true,
		disable_surveys: true,
		disable_surveys_automatic_display: true,
		disable_product_tours: true,
		disable_web_experiments: true,
		disable_external_dependency_loading: true,
		advanced_disable_flags: true,
		remote_config_refresh_interval_ms: 0,
		opt_in_site_apps: false,
		cookieless_mode: 'on_reject',
		opt_out_capturing_by_default: true,
		opt_out_persistence_by_default: true,
		opt_out_capturing_persistence_type: 'localStorage',
		consent_persistence_name: ANALYTICS_CONSENT_KEY,
		persistence: 'localStorage',
		persistence_name: 'sequit-analytics',
		person_profiles: 'never',
		respect_dnt: true,
		ip: false,
		save_referrer: false,
		save_campaign_params: false,
		disable_capture_url_hashes: true,
		disable_scroll_properties: true,
		before_send: beforeSend,
	});
	initialized = true;
}

/** Captures only the safe SvelteKit route template, never the browser's raw URL. */
export function captureAnalyticsPageview(routeId: string | null): void {
	if (!initialized) return;
	if (typeof window === 'undefined') return;

	activeRoute = safeRoute(routeId);
	if (activeRoute === undefined) return;

	posthog.capture('$pageview', {
		$current_url: activeRoute.currentUrl,
		$pathname: activeRoute.pathname,
		$geoip_disable: true,
	});
}

/** Returns a saved analytics choice, or undefined while consent is pending/unavailable. */
export function readAnalyticsConsent(): boolean | undefined {
	if (typeof window === 'undefined') return undefined;
	if (privacySignalIsEnabled()) return false;

	try {
		const value = localStorageOrUndefined()?.getItem(ANALYTICS_CONSENT_KEY);
		if (value === '1') return true;
		if (value === '0') return false;
	} catch {
		// Storage restrictions leave consent pending for this page.
	}
	return undefined;
}

/** Persists the user's choice and applies it immediately when the SDK is initialized. */
export function setAnalyticsConsent(allow: boolean): void {
	if (initialized) {
		// The SDK must transition identity before persisting the new consent state.
		if (allow) posthog.opt_in_capturing({ captureEventName: false });
		else posthog.opt_out_capturing();
		return;
	}
	let storedChoice = '0';
	if (allow) storedChoice = '1';
	try {
		localStorageOrUndefined()?.setItem(ANALYTICS_CONSENT_KEY, storedChoice);
	} catch {
		// PostHog's consent manager also handles unavailable local storage.
	}
}
