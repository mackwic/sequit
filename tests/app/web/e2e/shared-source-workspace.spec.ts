import { expect, test } from '@playwright/test';
import type { Component } from 'svelte';
import type * as Y from 'yjs';

import type { LogicDocument } from '../../../../src/lib/core/document/logic-document';
import type {
	CollaborationTransport,
	TransportStatus,
} from '../../../../src/lib/infrastructure/collaboration/collaboration-transport';
import type { CollaborativeDocumentSession } from '../../../../src/lib/infrastructure/collaboration/collaborative-document-session-types';
import { validLogicDocument } from '../../../support/builders/logic-document';
import type {
	mount as svelteMount,
	unmount as svelteUnmount,
} from '../../../support/harnesses/browser-svelte-runtime';

test('a physical invalid source removes shared editing controls and restores them after healing', async ({
	page,
}) => {
	await page.goto('/');
	const initial = validLogicDocument();
	const node = initial.nodes[0];
	if (node === undefined) throw new Error('Expected a source node');
	const ungrouped = { ...node };
	delete ungrouped.groupId;
	const source: LogicDocument = {
		...initial,
		id: 'workspace-physical-source',
		title: 'Workspace physical source',
		groups: [],
		nodes: [ungrouped],
		junctions: [],
		relations: [],
	};
	const observed = await page.evaluate(async (documentSource) => {
		function isSessionModule(value: unknown): value is {
			CollaborativeSession: new (
				initial: LogicDocument,
				transport: CollaborationTransport,
			) => CollaborativeDocumentSession;
		} {
			return (
				typeof value === 'object' &&
				value !== null &&
				'CollaborativeSession' in value &&
				typeof value.CollaborativeSession === 'function'
			);
		}
		function isTransportModule(
			value: unknown,
		): value is { TransportStatus: { Disconnected: TransportStatus } } {
			return (
				typeof value === 'object' &&
				value !== null &&
				'TransportStatus' in value &&
				typeof value.TransportStatus === 'object'
			);
		}
		function isCodecModule(
			value: unknown,
		): value is { importLogicDocument: (document: Y.Doc, source: LogicDocument) => void } {
			return (
				typeof value === 'object' &&
				value !== null &&
				'importLogicDocument' in value &&
				typeof value.importLogicDocument === 'function'
			);
		}
		function isSchemaModule(value: unknown): value is {
			YjsCollection: { Relations: string };
			createYjsEntityMap: (values: Readonly<Record<string, unknown>>) => Y.Map<unknown>;
		} {
			return (
				typeof value === 'object' &&
				value !== null &&
				'YjsCollection' in value &&
				'createYjsEntityMap' in value &&
				typeof value.createYjsEntityMap === 'function'
			);
		}
		function isWorkspaceModule(value: unknown): value is {
			default: Component<{
				client: CollaborativeDocumentSession;
				model: LogicDocument;
				name: string;
				connected: boolean;
			}>;
		} {
			return (
				typeof value === 'object' &&
				value !== null &&
				'default' in value &&
				typeof value.default === 'function'
			);
		}
		function isSvelteModule(
			value: unknown,
		): value is { mount: typeof svelteMount; unmount: typeof svelteUnmount } {
			return (
				typeof value === 'object' &&
				value !== null &&
				'mount' in value &&
				typeof value.mount === 'function' &&
				'unmount' in value &&
				typeof value.unmount === 'function'
			);
		}
		const importModule = (specifier: string): Promise<unknown> =>
			import(/* @vite-ignore */ specifier);
		const [
			sessionModule,
			transportModule,
			codecModule,
			schemaModule,
			workspaceModule,
			svelteModule,
		] = await Promise.all([
			importModule('/src/lib/infrastructure/collaboration/collaborative-session.ts'),
			importModule('/src/lib/infrastructure/collaboration/collaboration-transport.ts'),
			importModule('/src/lib/infrastructure/collaboration/yjs-document-codec.ts'),
			importModule('/src/lib/infrastructure/collaboration/yjs-document-schema.ts'),
			importModule('/src/app/web/ui/components/collaboration/CollaborativeWorkspace.svelte'),
			importModule('/tests/support/harnesses/browser-svelte-runtime.ts'),
		]);
		if (!isSessionModule(sessionModule)) throw new Error('Invalid collaborative session module');
		if (!isTransportModule(transportModule)) throw new Error('Invalid transport module');
		if (!isCodecModule(codecModule)) throw new Error('Invalid Yjs codec module');
		if (!isSchemaModule(schemaModule)) throw new Error('Invalid Yjs schema module');
		if (!isWorkspaceModule(workspaceModule)) throw new Error('Invalid workspace module');
		if (!isSvelteModule(svelteModule)) throw new Error('Invalid Svelte module');
		const { CollaborativeSession } = sessionModule;
		const { TransportStatus } = transportModule;
		const { importLogicDocument } = codecModule;
		const { createYjsEntityMap, YjsCollection } = schemaModule;
		const { default: Workspace } = workspaceModule;
		const { mount, unmount } = svelteModule;
		const transport: CollaborationTransport = {
			send() {
				throw new Error('This local transport has no server');
			},
			subscribeToFrames: () => () => undefined,
			subscribeToStatus: () => () => undefined,
			status: () => TransportStatus.Disconnected,
			close() {
				return undefined;
			},
		};
		const client = new CollaborativeSession(documentSource, transport);
		importLogicDocument(client.document, documentSource);
		const initialSourceState = client.readSourceState();
		if (!('document' in initialSourceState))
			throw new Error(`Expected valid seeded source, got ${initialSourceState.kind}`);
		const host = document.createElement('div');
		document.body.appendChild(host);
		const component = mount(Workspace, {
			target: host,
			props: { client, model: documentSource, name: 'Alice', connected: true },
		});
		async function until(selector: string, phase: string): Promise<void> {
			const deadline = performance.now() + 5_000;
			while (host.querySelector(selector) === null) {
				if (performance.now() > deadline)
					throw new Error(
						`Timed out ${phase} waiting for ${selector}; source=${client.readSourceState().kind}`,
					);
				await new Promise((resolve) => setTimeout(resolve, 10));
			}
		}
		try {
			await until('[data-graph-stage]', 'before');
			await until('aside button[aria-label="Modifier Titre du document"]', 'before');
			const before = {
				titleEditControl:
					host.querySelector('aside button[aria-label="Modifier Titre du document"]') !== null,
				structureControls: host.querySelector('aside fieldset') !== null,
				stage: host.querySelector('[data-graph-stage]') !== null,
			};
			const relations = client.document.getMap(YjsCollection.Relations);
			relations.set(
				'dangling-physical-relation',
				createYjsEntityMap({ from: 'source-a', to: 'missing-physical-node' }),
			);
			await until('[data-source-diagnostic]', 'invalid');
			await until('aside p', 'invalid');
			const invalid = {
				titleEditControl:
					host.querySelector('aside button[aria-label="Modifier Titre du document"]') !== null,
				structureControls: host.querySelector('aside fieldset') !== null,
				stage: host.querySelector('[data-graph-stage]') !== null,
				overlay: host.querySelector('[data-canvas-overlay]') !== null,
				aside: host.querySelector('aside')?.textContent,
			};
			relations.delete('dangling-physical-relation');
			await until('[data-graph-stage]', 'healed');
			await until('aside button[aria-label="Modifier Titre du document"]', 'healed');
			const healed = {
				titleEditControl:
					host.querySelector('aside button[aria-label="Modifier Titre du document"]') !== null,
				structureControls: host.querySelector('aside fieldset') !== null,
				stage: host.querySelector('[data-graph-stage]') !== null,
				sourceDiagnostic: host.querySelector('[data-source-diagnostic]') !== null,
			};
			return { before, invalid, healed };
		} finally {
			await unmount(component);
			client.destroy();
			host.remove();
		}
	}, source);
	expect(observed.before).toEqual({ titleEditControl: true, structureControls: true, stage: true });
	expect(observed.invalid).toMatchObject({
		titleEditControl: false,
		structureControls: false,
		stage: false,
		overlay: false,
	});
	expect(observed.invalid.aside).toContain(
		'ne peut pas être édité tant que sa source est invalide',
	);
	expect(observed.healed).toEqual({
		titleEditControl: true,
		structureControls: true,
		stage: true,
		sourceDiagnostic: false,
	});
});
