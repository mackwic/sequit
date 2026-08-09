/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
	forbidden: [
		{
			name: 'no-circular-dependencies',
			severity: 'error',
			from: { path: '^(src|workers/collaboration/src)/' },
			to: { circular: true },
		},
		{
			name: 'production-does-not-depend-on-tests',
			severity: 'error',
			from: { path: '^(src|workers/collaboration/src)/' },
			to: { path: '^(tests|workers/collaboration/test)/' },
		},
		{
			name: 'library-does-not-depend-on-routes',
			severity: 'error',
			from: { path: '^src/lib/' },
			to: { path: '^src/routes/' },
		},
		{
			name: 'non-ui-code-does-not-depend-on-components',
			severity: 'error',
			from: { path: '^src/lib/(?!components/)' },
			to: { path: '^src/lib/components/' },
		},
		{
			name: 'domain-core-has-no-outward-dependencies',
			severity: 'error',
			from: {
				path: '^src/lib/document/(logic-document|validate-logic-document)[.]ts$',
			},
			to: {
				path: '^src/lib/',
				pathNot:
					'^src/lib/(canonical-string|document/(logic-document|order-key|validate-logic-document))[.]ts$',
			},
		},
		{
			name: 'graph-only-depends-on-domain-core',
			severity: 'error',
			from: { path: '^src/lib/graph/' },
			to: {
				path: '^src/lib/',
				pathNot: [
					'^src/lib/graph/',
					'^src/lib/canonical-string[.]ts$',
					'^src/lib/document/(logic-document|order-key|validate-logic-document)[.]ts$',
				],
			},
		},
		{
			name: 'text-only-depends-on-domain-core',
			severity: 'error',
			from: { path: '^src/lib/text/' },
			to: {
				path: '^src/lib/',
				pathNot: [
					'^src/lib/text/',
					'^src/lib/canonical-string[.]ts$',
					'^src/lib/document/(logic-document|order-key|validate-logic-document)[.]ts$',
				],
			},
		},
		{
			name: 'collaboration-only-depends-on-domain-core',
			severity: 'error',
			from: {
				path: '^src/lib/collaboration/',
				pathNot:
					'^src/lib/collaboration/(authorize-proposal|update-guards|yjs-document-codec)[.]ts$',
			},
			to: {
				path: '^src/lib/',
				pathNot: [
					'^src/lib/collaboration/',
					'^src/lib/canonical-string[.]ts$',
					'^src/lib/document/(document-command-gateway|document-session|logic-document|order-key|topology-edits|validate-logic-document)[.]ts$',
				],
			},
		},
		{
			name: 'collaboration-graph-aware-modules-depend-on-graph-and-core',
			severity: 'error',
			from: {
				path: '^src/lib/collaboration/(authorize-proposal|update-guards|yjs-document-codec)[.]ts$',
			},
			to: {
				path: '^src/lib/',
				pathNot: [
					'^src/lib/collaboration/',
					'^src/lib/canonical-string[.]ts$',
					'^src/lib/graph/',
					'^src/lib/document/(logic-document|order-key|validate-logic-document)[.]ts$',
				],
			},
		},
		{
			name: 'layout-only-depends-inward',
			severity: 'error',
			from: { path: '^src/lib/layout/' },
			to: {
				path: '^src/lib/',
				pathNot: [
					'^src/lib/layout/',
					'^src/lib/graph/',
					'^src/lib/canonical-string[.]ts$',
					'^src/lib/document/(logic-document|order-key|validate-logic-document)[.]ts$',
				],
			},
		},
		{
			name: 'canvas-only-depends-inward',
			severity: 'error',
			from: { path: '^src/lib/canvas/' },
			to: {
				path: '^src/lib/',
				pathNot: [
					'^src/lib/canvas/',
					'^src/lib/layout/',
					'^src/lib/document/(logic-document|validate-logic-document)[.]ts$',
				],
			},
		},
		{
			name: 'session-only-depends-inward',
			severity: 'error',
			from: { path: '^src/lib/session/' },
			to: {
				path: '^src/lib/',
				pathNot: [
					'^src/lib/session/',
					'^src/lib/canvas/',
					'^src/lib/document/',
					'^src/lib/graph/',
					'^src/lib/layout/',
				],
			},
		},
		{
			name: 'worker-only-depends-on-shared-core',
			severity: 'error',
			from: { path: '^workers/collaboration/src/' },
			to: {
				path: '^src/lib/',
				pathNot: [
					'^src/lib/collaboration/',
					'^src/lib/document/(logic-document|validate-logic-document)[.]ts$',
				],
			},
		},
	],
	options: {
		doNotFollow: { path: 'node_modules' },
		includeOnly: ['^src/', '^workers/collaboration/src/'],
		tsConfig: { fileName: 'tsconfig.json' },
		tsPreCompilationDeps: true,
	},
};
