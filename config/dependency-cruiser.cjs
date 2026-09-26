const layoutPath = '^src/lib/core/layout/';
const layoutScopes = {
	base: `${layoutPath}layout-(types|settings)[.]ts$`,
	engine: `${layoutPath}(layout-engine|layout-workspace|layout-port-placement|build-layout-result)[.]ts$`,
	root: `${layoutPath}root-region[.]ts$`,
	geometry: `${layoutPath}geometry/`,
	structure: `${layoutPath}structure/`,
	placement: `${layoutPath}placement/`,
	routing: `${layoutPath}routing/`,
	inspection: `${layoutPath}inspection/`,
	resources: `${layoutPath}resources/`,
	search: `${layoutPath}search/`,
	bridges: `${layoutPath}bridges/`,
	'dedicated-candidate-validation': `${layoutPath}dedicated-candidate-validation/`,
	rank: `${layoutPath}rank/`,
	contract: `${layoutPath}contract/`,
	'regions/model': `${layoutPath}regions/model/`,
	'regions/composition': `${layoutPath}regions/composition/`,
	lanes: `${layoutPath}lanes/`,
	'regions/validation': `${layoutPath}regions/validation/`,
	'regions/leaf': `${layoutPath}regions/leaf/`,
	grids: `${layoutPath}grids/`,
	'regions/recursive': `${layoutPath}regions/recursive/`,
	folded: `${layoutPath}folded/`,
};

// A directory may import itself and only the dependencies listed here.
const layoutImports = {
	base: [],
	resources: [],
	search: ['geometry'],
	bridges: ['geometry', 'base'],
	'dedicated-candidate-validation': ['bridges', 'routing', 'structure', 'geometry', 'base'],
	rank: ['dedicated-candidate-validation', 'structure', 'base'],
	engine: ['rank', 'inspection', 'placement', 'routing', 'structure', 'geometry', 'base'],
	contract: ['engine', 'rank', 'bridges', 'routing', 'structure', 'search', 'geometry', 'base'],
	'regions/model': ['bridges', 'resources', 'search', 'geometry', 'base'],
	'regions/composition': ['regions/model', 'bridges', 'resources', 'base'],
	lanes: [
		'regions/composition',
		'regions/model',
		'bridges',
		'resources',
		'search',
		'placement',
		'geometry',
		'base',
	],
	'regions/validation': ['regions/model', 'bridges', 'geometry', 'base'],
	'regions/leaf': [
		'lanes',
		'rank',
		'contract',
		'engine',
		'regions/composition',
		'regions/model',
		'bridges',
		'search',
		'geometry',
		'base',
	],
	grids: [
		'regions/leaf',
		'regions/validation',
		'regions/composition',
		'regions/model',
		'contract',
		'bridges',
		'resources',
		'search',
		'geometry',
		'base',
	],
	'regions/recursive': [
		'grids',
		'regions/leaf',
		'regions/validation',
		'regions/composition',
		'regions/model',
		'bridges',
		'geometry',
		'base',
	],
	root: ['regions/recursive', 'regions/model', 'lanes', 'engine', 'geometry', 'base'],
	folded: ['base'],
};

function layoutScope(group) {
	const scope = layoutScopes[group];
	if (scope === undefined) throw new Error(`Unknown layout dependency scope: ${group}`);
	return scope;
}

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
	forbidden: [
		{
			name: 'layout-geometry-is-independent',
			severity: 'error',
			from: { path: '^src/lib/core/layout/geometry/' },
			to: {
				path: '^src/lib/core/layout/',
				pathNot: '^src/lib/core/layout/(geometry/|layout-types[.]ts$)',
			},
		},
		{
			name: 'layout-structure-is-independent',
			severity: 'error',
			from: { path: '^src/lib/core/layout/structure/' },
			to: {
				path: '^src/lib/core/layout/',
				pathNot: '^src/lib/core/layout/(structure/|geometry/|layout-(types|settings)[.]ts$)',
			},
		},
		{
			name: 'layout-placement-does-not-depend-on-routing',
			severity: 'error',
			from: { path: '^src/lib/core/layout/placement/' },
			to: {
				path: '^src/lib/core/layout/',
				pathNot:
					'^src/lib/core/layout/(placement/|structure/|geometry/|layout-(types|settings)[.]ts$)',
			},
		},
		{
			name: 'layout-routing-does-not-depend-on-placement',
			severity: 'error',
			from: { path: '^src/lib/core/layout/routing/' },
			to: {
				path: '^src/lib/core/layout/',
				pathNot: '^src/lib/core/layout/(routing/|geometry/|layout-(types|settings)[.]ts$)',
			},
		},
		{
			name: 'layout-inspection-does-not-reenter-engine',
			severity: 'error',
			from: { path: '^src/lib/core/layout/inspection/' },
			to: {
				path: '^src/lib/core/layout/',
				pathNot:
					'^src/lib/core/layout/(inspection/|routing/|geometry/|layout-(types|settings)[.]ts$)',
			},
		},
		...Object.entries(layoutImports).map(([directory, permitted]) => ({
			name: `layout-${directory.replace('/', '-')}-only-inward`,
			severity: 'error',
			from: { path: layoutScope(directory) },
			to: {
				path: layoutPath,
				pathNot: [layoutScope(directory), ...permitted.map(layoutScope)].join('|'),
			},
		})),
		{
			name: 'layout-workspace-only-belongs-to-orchestration',
			severity: 'error',
			from: { path: '^src/', pathNot: '^src/lib/core/layout/layout-engine[.]ts$' },
			to: { path: '^src/lib/core/layout/layout-workspace[.]ts$' },
		},
		{
			name: 'visual-scenarios-use-the-layout-harness',
			severity: 'error',
			from: { path: '^tests/scenarios/visual/.*[.]scenario[.]ts$' },
			to: {
				path: '^(src/(lib/core/(graph/(create-graph|topological-ranks)|layout/)|app/web/(projection/layout-graph|ui/canvas/render-relations))|tests/support/assertions/assert-layout-routing)',
			},
		},
		{
			name: 'visual-scenarios-and-support-are-runner-and-ui-independent',
			severity: 'error',
			from: {
				path: '^tests/(scenarios/visual/|support/(assertions|builders|fixtures|harnesses)/)',
				pathNot: '\\.(test|spec)\\.ts$',
			},
			to: {
				path: '(node_modules/(@vitest/|vitest/|@playwright/|playwright(-core)?/)|\\.(test|spec)\\.ts$|\\.svelte$)',
			},
		},
		{
			name: 'no-circular-dependencies',
			severity: 'error',
			from: { path: '^(src/|tests/(support|scenarios)/)' },
			to: { circular: true },
		},
		{
			name: 'production-does-not-depend-on-tests',
			severity: 'error',
			from: { path: '^src/', pathNot: '^src/app/workshop/visual-tests/' },
			to: { path: '(^tests/|/test/)' },
		},
		{
			name: 'visual-workshop-only-depends-on-test-support-and-scenarios',
			severity: 'error',
			from: { path: '^src/app/workshop/visual-tests/' },
			to: {
				path: '^tests/',
				pathNot: '^tests/(support|scenarios)/',
			},
		},
		{
			name: 'visual-workshop-does-not-import-test-runners',
			severity: 'error',
			from: { path: '^src/app/workshop/visual-tests/' },
			to: { path: '\\.(test|spec)\\.ts$' },
		},
		{
			name: 'library-does-not-depend-on-applications',
			severity: 'error',
			from: { path: '^src/lib/' },
			to: { path: '^src/(app|routes|workers)/' },
		},
		{
			name: 'core-has-no-outward-dependencies',
			severity: 'error',
			from: { path: '^src/lib/core/' },
			to: { path: '^src/', pathNot: '^src/lib/core/' },
		},
		{
			name: 'core-only-uses-pure-external-libraries',
			severity: 'error',
			from: { path: '^src/lib/core/' },
			to: { dependencyTypes: ['npm', 'npm-dev', 'core'], pathNot: '(^|/)fractional-indexing/' },
		},
		{
			name: 'web-does-not-depend-on-workshop',
			severity: 'error',
			from: { path: '^src/app/web/' },
			to: { path: '^src/app/workshop/' },
		},
		{
			name: 'applications-do-not-depend-on-workers-or-routes',
			severity: 'error',
			from: { path: '^src/app/' },
			to: { path: '^src/(workers|routes)/' },
		},
		{
			name: 'workers-do-not-depend-on-applications',
			severity: 'error',
			from: { path: '^src/workers/' },
			to: { path: '^src/(app|routes)/' },
		},
		{
			name: 'non-ui-code-does-not-depend-on-components',
			severity: 'error',
			from: { path: '^src/app/web/', pathNot: '^src/app/web/ui/components/' },
			to: { path: '^src/app/web/ui/components/' },
		},
		{
			name: 'fixtures-only-depend-on-domain-core',
			severity: 'error',
			from: { path: '^src/app/workshop/fixtures/' },
			to: {
				path: '^src/',
				pathNot: [
					'^src/app/workshop/fixtures/',
					'^src/lib/core/document/(logic-document|order-key)[.]ts$',
				],
			},
		},
		{
			name: 'domain-model-has-no-outward-dependencies',
			severity: 'error',
			from: {
				path: '^src/lib/core/document/(logic-document|region-leaf-lane-presentation|region-presentation|region-presentation-issues|validate-grid-presentation|validate-lane-document|validate-logic-document|validate-region-document)[.]ts$',
			},
			to: {
				path: '^src/',
				pathNot:
					'^src/lib/core/(canonical-string|document/(logic-document|order-key|region-leaf-lane-presentation|region-presentation|region-presentation-issues|validate-grid-presentation|validate-lane-document|validate-logic-document|validate-region-document))[.]ts$',
			},
		},
		{
			name: 'graph-only-depends-on-domain-core',
			severity: 'error',
			from: { path: '^src/lib/core/graph/' },
			to: {
				path: '^src/',
				pathNot: [
					'^src/lib/core/graph/',
					'^src/lib/core/canonical-string[.]ts$',
					'^src/lib/core/document/(logic-document|order-key|region-presentation|validate-logic-document|validate-region-document)[.]ts$',
				],
			},
		},
		{
			name: 'ordering-only-depends-on-domain-core',
			severity: 'error',
			from: { path: '^src/lib/core/ordering/' },
			to: {
				path: '^src/',
				pathNot: [
					'^src/lib/core/ordering/',
					'^src/lib/core/canonical-string[.]ts$',
					'^src/lib/core/document/(logic-document|order-key|region-presentation)[.]ts$',
				],
			},
		},
		{
			name: 'text-only-depends-on-domain-core',
			severity: 'error',
			from: { path: '^src/lib/infrastructure/toml/' },
			to: {
				path: '^src/',
				pathNot: [
					'^src/lib/infrastructure/toml/',
					'^src/lib/core/canonical-string[.]ts$',
					'^src/lib/core/document/(logic-document|order-key|region-presentation|validate-logic-document|validate-region-document)[.]ts$',
				],
			},
		},
		{
			name: 'layout-only-depends-inward',
			severity: 'error',
			from: { path: '^src/lib/core/layout/' },
			to: {
				path: '^src/',
				pathNot: [
					'^src/lib/core/(layout|ordering|graph)/',
					'^src/lib/core/canonical-string[.]ts$',
					'^src/lib/core/document/(logic-document|order-key|region-presentation|validate-logic-document|validate-region-document)[.]ts$',
				],
			},
		},
		{
			name: 'collaboration-only-depends-on-core-and-contracts',
			severity: 'error',
			from: {
				path: '^src/lib/infrastructure/collaboration/',
				pathNot:
					'^src/lib/infrastructure/collaboration/(authorize-proposal|update-guards|yjs-document-codec)[.]ts$',
			},
			to: {
				path: '^src/',
				pathNot: [
					'^src/lib/infrastructure/(collaboration|document)/',
					'^src/lib/core/canonical-string[.]ts$',
					'^src/lib/core/document/(logic-document|order-key|region-presentation|topology-edits|validate-logic-document|validate-region-document)[.]ts$',
				],
			},
		},
		{
			name: 'collaboration-graph-aware-modules-depend-on-graph-and-core',
			severity: 'error',
			from: {
				path: '^src/lib/infrastructure/collaboration/(authorize-proposal|update-guards|yjs-document-codec)[.]ts$',
			},
			to: {
				path: '^src/',
				pathNot: [
					'^src/lib/infrastructure/collaboration/',
					'^src/lib/core/graph/',
					'^src/lib/core/canonical-string[.]ts$',
					'^src/lib/core/document/(logic-document|order-key|region-presentation|validate-logic-document|validate-region-document)[.]ts$',
				],
			},
		},
		{
			name: 'canvas-only-depends-inward',
			severity: 'error',
			from: { path: '^src/app/web/ui/canvas/' },
			to: {
				path: '^src/',
				pathNot: [
					'^src/app/web/ui/canvas/',
					'^src/app/web/projection/layout-graph[.]ts$',
					'^src/lib/core/layout/',
					'^src/lib/core/document/(logic-document|region-presentation|validate-logic-document|validate-region-document)[.]ts$',
				],
			},
		},
		{
			name: 'session-only-depends-inward',
			severity: 'error',
			from: { path: '^src/app/web/ui/session/' },
			to: {
				path: '^src/',
				pathNot: [
					'^src/app/web/ui/(session|canvas)/',
					'^src/lib/infrastructure/document/',
					'^src/lib/core/(document|graph|layout)/',
				],
			},
		},
		{
			name: 'worker-only-depends-on-shared-core',
			severity: 'error',
			from: { path: '^src/workers/collaboration-worker/' },
			to: {
				path: '^src/lib/',
				pathNot: [
					'^src/lib/infrastructure/collaboration/',
					'^src/lib/core/document/(logic-document|validate-logic-document)[.]ts$',
				],
			},
		},
	],
	options: {
		doNotFollow: { path: 'node_modules' },
		includeOnly: ['^src/', '^tests/(support|scenarios)/'],
		exclude: { path: '(^src/workers/.*/vitest[.]config[.]ts|/[.](wrangler|svelte-kit)/)' },
		tsConfig: { fileName: 'tsconfig.json' },
		tsPreCompilationDeps: true,
	},
};
