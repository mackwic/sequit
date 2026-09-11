declare module '*.svx' {
	import type { Component } from 'svelte';
	import type { VisualTestSettings } from './directions';
	const component: Component<{ settings: VisualTestSettings }>;
	export default component;
}
