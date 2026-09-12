import type { LayoutScenario } from './scenario';

// Only TypeScript is loaded here: the same catalogue runs in Vitest and the gallery.
const scenarios = import.meta.glob<LayoutScenario>('./**/*.scenario.ts', {
	eager: true,
	import: 'scenario',
});

export const catalogue = Object.entries(scenarios)
	.map(([path, scenario]) => ({
		scenario,
		documentPath: path.replace(/\.scenario\.ts$/, '.svx'),
	}))
	.sort(
		(a, b) => a.scenario.order - b.scenario.order || a.scenario.id.localeCompare(b.scenario.id),
	);
