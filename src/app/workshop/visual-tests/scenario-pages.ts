import type { Component } from 'svelte';

import type { VisualTestSettings } from './directions';

// UI-only loaders: keep Markdown and Svelte outside the executable catalogue.
export const scenarioPages = import.meta.glob<{
	default: Component<{ settings: VisualTestSettings }>;
}>('/tests/scenarios/visual/**/*.svx');
