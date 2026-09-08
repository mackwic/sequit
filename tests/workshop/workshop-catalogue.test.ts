import { expect, it, vi } from 'vitest';

import { createGraph } from '../../src/lib/graph/create-graph';
import { parseSequitToml } from '../../src/lib/text/parse-sequit-toml';
import { workshopGroups } from '../../src/routes/atelier/catalogue';
vi.mock('../../src/routes/atelier/InlineScene.svelte', () => ({ default: vi.fn() }));
vi.mock('../../src/routes/atelier/ModalScene.svelte', () => ({ default: vi.fn() }));
vi.mock('../../src/routes/atelier/PanelScene.svelte', () => ({ default: vi.fn() }));
vi.mock('../../src/routes/atelier/CollaborationScene.svelte', () => ({ default: vi.fn() }));
vi.mock('../../src/routes/atelier/WorkbenchScene.svelte', () => ({ default: vi.fn() }));
vi.mock('../../src/routes/atelier/tools/ContentTools.svelte', () => ({ default: vi.fn() }));
vi.mock('../../src/routes/atelier/tools/ConnectionTools.svelte', () => ({ default: vi.fn() }));
vi.mock('../../src/routes/atelier/tools/ContextTools.svelte', () => ({ default: vi.fn() }));
vi.mock('../../src/routes/atelier/tools/CreationTools.svelte', () => ({ default: vi.fn() }));
vi.mock('../../src/routes/atelier/tools/DocumentTools.svelte', () => ({ default: vi.fn() }));
vi.mock('../../src/routes/atelier/tools/GroupTools.svelte', () => ({ default: vi.fn() }));
vi.mock('../../src/routes/atelier/tools/JunctionTools.svelte', () => ({ default: vi.fn() }));
vi.mock('../../src/routes/atelier/tools/LayoutTools.svelte', () => ({ default: vi.fn() }));
vi.mock('../../src/routes/atelier/tools/NatureTools.svelte', () => ({ default: vi.fn() }));
vi.mock('../../src/routes/atelier/tools/NavigationTools.svelte', () => ({ default: vi.fn() }));
vi.mock('../../src/routes/atelier/tools/RecoveryTools.svelte', () => ({ default: vi.fn() }));
vi.mock('../../src/routes/atelier/tools/SelectionTools.svelte', () => ({ default: vi.fn() }));
vi.mock('../../src/routes/atelier/tools/TextTools.svelte', () => ({ default: vi.fn() }));
it('keeps IDs unique and each workshop fixture valid across its variants', () => {
	const scenarios = workshopGroups.flatMap((group) => group.scenarios);
	expect(scenarios).toHaveLength(15);
	expect(new Set(scenarios.map((item) => item.id)).size).toBe(15);
	for (const scenario of scenarios) {
		const parsed = parseSequitToml(scenario.source);
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) throw new Error('Invalid fixture');
		expect(createGraph(parsed.value).ok).toBe(true);
		expect(new Set(scenario.variants.map((item) => item.id)).size).toBe(scenario.variants.length);
		expect(scenario.variants.length).toBeGreaterThan(1);
	}
});
