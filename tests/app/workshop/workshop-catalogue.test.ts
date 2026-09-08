import { expect, it, vi } from 'vitest';

import { workshopGroups } from '../../../src/app/workshop/catalogue';
import { createGraph } from '../../../src/lib/core/graph/create-graph';
import { parseSequitToml } from '../../../src/lib/infrastructure/toml/parse-sequit-toml';
vi.mock('../../../src/app/workshop/InlineScene.svelte', () => ({ default: vi.fn() }));
vi.mock('../../../src/app/workshop/ModalScene.svelte', () => ({ default: vi.fn() }));
vi.mock('../../../src/app/workshop/PanelScene.svelte', () => ({ default: vi.fn() }));
vi.mock('../../../src/app/workshop/CollaborationScene.svelte', () => ({ default: vi.fn() }));
vi.mock('../../../src/app/workshop/WorkbenchScene.svelte', () => ({ default: vi.fn() }));
vi.mock('../../../src/app/workshop/tools/ContentTools.svelte', () => ({ default: vi.fn() }));
vi.mock('../../../src/app/workshop/tools/ConnectionTools.svelte', () => ({ default: vi.fn() }));
vi.mock('../../../src/app/workshop/tools/ContextTools.svelte', () => ({ default: vi.fn() }));
vi.mock('../../../src/app/workshop/tools/CreationTools.svelte', () => ({ default: vi.fn() }));
vi.mock('../../../src/app/workshop/tools/DocumentTools.svelte', () => ({ default: vi.fn() }));
vi.mock('../../../src/app/workshop/tools/GroupTools.svelte', () => ({ default: vi.fn() }));
vi.mock('../../../src/app/workshop/tools/JunctionTools.svelte', () => ({ default: vi.fn() }));
vi.mock('../../../src/app/workshop/tools/LayoutTools.svelte', () => ({ default: vi.fn() }));
vi.mock('../../../src/app/workshop/tools/NatureTools.svelte', () => ({ default: vi.fn() }));
vi.mock('../../../src/app/workshop/tools/NavigationTools.svelte', () => ({ default: vi.fn() }));
vi.mock('../../../src/app/workshop/tools/RecoveryTools.svelte', () => ({ default: vi.fn() }));
vi.mock('../../../src/app/workshop/tools/SelectionTools.svelte', () => ({ default: vi.fn() }));
vi.mock('../../../src/app/workshop/tools/TextTools.svelte', () => ({ default: vi.fn() }));
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
