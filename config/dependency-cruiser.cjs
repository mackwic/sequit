/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
	forbidden: [
		{
			name: 'no-circular-dependencies',
			severity: 'error',
			from: { path: '^src/' },
			to: { circular: true },
		},
		{
			name: 'production-does-not-depend-on-tests',
			severity: 'error',
			from: { path: '^src/' },
			to: { path: '(^tests/|/test/)' },
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
			from: { path: '^src/lib/core/document/(logic-document|validate-logic-document)[.]ts$' },
			to: {
				path: '^src/',
				pathNot:
					'^src/lib/core/(canonical-string|document/(logic-document|order-key|validate-logic-document))[.]ts$',
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
					'^src/lib/core/document/(logic-document|order-key|validate-logic-document)[.]ts$',
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
					'^src/lib/core/document/(logic-document|order-key)[.]ts$',
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
					'^src/lib/core/document/(logic-document|order-key|validate-logic-document)[.]ts$',
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
					'^src/lib/core/document/(logic-document|order-key|validate-logic-document)[.]ts$',
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
					'^src/lib/core/document/(logic-document|order-key|topology-edits|validate-logic-document)[.]ts$',
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
					'^src/lib/core/document/(logic-document|order-key|validate-logic-document)[.]ts$',
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
					'^src/lib/core/document/(logic-document|validate-logic-document)[.]ts$',
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
		includeOnly: ['^src/'],
		exclude: { path: '(^src/workers/.*/vitest[.]config[.]ts|/[.](wrangler|svelte-kit)/)' },
		tsConfig: { fileName: 'tsconfig.json' },
		tsPreCompilationDeps: true,
	},
};
