import { AI_DOCUMENTARY_EFFORT_SOURCE } from '../../../lib/document/example-document';
import type { LogicDocument } from '../../../lib/document/logic-document';
import { LAYOUT_PERFORMANCE_NODE_COUNTS } from '../../../lib/fixtures/layout-performance/node-counts';
import type { LayoutPerformanceScenarioName } from '../../../lib/fixtures/layout-performance/scenario-name';
import { LAYOUT_PERFORMANCE_SCENARIOS } from '../../../lib/fixtures/layout-performance/scenarios';
import { createGraph } from '../../../lib/graph/create-graph';
import { parseSequitToml } from '../../../lib/text/parse-sequit-toml';
import { serializeSequitToml } from '../../../lib/text/serialize-sequit-toml';
import simpleSource from '../scenario.toml?raw';

export const workshopFixtureLabels: Readonly<Record<LayoutPerformanceScenarioName, string>> = {
	'long-queue': 'Chaîne longue',
	'binary-tree': 'Arbre binaire',
	unbalanced: 'Branches déséquilibrées',
	'unbalanced-random': 'Branches à dominante variable',
	subgroups: 'Deux groupes',
	'nested-subgroups': 'Groupes imbriqués',
	'wide-bipartite-layers': 'Couches densément reliées',
	'repeated-diamonds': 'Divergences et convergences',
	'disconnected-components': 'Composantes séparées',
	'junction-heavy': 'Chaîne avec jonctions XOR',
	'group-relations': 'Relations entre groupes',
	'shallow-groups': 'Groupes côte à côte',
};

function describeFixture(
	id: WorkshopFixture['id'],
	label: string,
	kind: WorkshopFixture['kind'],
	document: LogicDocument,
	source: string,
): WorkshopFixture {
	const graph = createGraph(document);
	let problem = '';
	if (!graph.ok) problem = graph.diagnostics.map(({ message }) => message).join('; ');
	return {
		id,
		label,
		kind,
		problem,
		source,
		nodeCount: document.nodes.length,
		groups: document.groups.length,
		junctions: document.junctions.length,
		relations: document.relations.length,
	};
}
function example(id: 'simple' | 'varied', label: string, source: string): WorkshopFixture {
	const parsed = parseSequitToml(source);
	if (!parsed.ok) throw new Error('Invalid workshop example');
	return describeFixture(id, label, 'example', parsed.value, source);
}
const simple = example('simple', 'Simple · premières interactions', simpleSource);
const varied = example(
	'varied',
	'Varié · document de la page d’accueil',
	AI_DOCUMENTARY_EFFORT_SOURCE,
);

/** Examples and benchmarks share their actual sources; only the requested workload is built. */
export function loadWorkshopFixture(params: URLSearchParams): WorkshopFixture | null {
	const id = params.get('fixture');
	if (id === 'parcours') return null;
	if (id === 'varied') return varied;
	const scenario = LAYOUT_PERFORMANCE_SCENARIOS.find(({ name }) => name === id);
	const nodeCount = LAYOUT_PERFORMANCE_NODE_COUNTS.find(
		(count) => String(count) === params.get('nodes'),
	);
	if (!scenario || nodeCount === undefined) return simple;
	const { document } = scenario.createBuilder().buildSnapshot(nodeCount);
	return describeFixture(
		scenario.name,
		workshopFixtureLabels[scenario.name],
		'performance',
		document,
		serializeSequitToml(document),
	);
}
export interface WorkshopFixture {
	readonly id: LayoutPerformanceScenarioName | 'simple' | 'varied';
	readonly kind: 'example' | 'performance';
	readonly label: string;
	readonly nodeCount: number;
	readonly groups: number;
	readonly junctions: number;
	readonly relations: number;
	readonly source: string;
	readonly problem: string;
}
