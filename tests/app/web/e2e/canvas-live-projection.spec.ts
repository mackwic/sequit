import { writeFile } from 'node:fs/promises';

import { expect, test } from '@playwright/test';

import { defined, GroupState } from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import {
	CollaborativeFixture,
	collaborativeFixture,
} from '../../../support/fixtures/collaborative-document';
import { seedRoom } from './collaboration-room';

test('remote text updates retain canvas DOM, focus, selection and zoom', async ({
	browser,
}, info) => {
	const room = `e2e-${crypto.randomUUID()}`;
	await seedRoom(room, CollaborativeFixture.TwoBoxes);
	const aliceContext = await browser.newContext();
	const bobContext = await browser.newContext();
	try {
		const alice = await aliceContext.newPage();
		const bob = await bobContext.newPage();
		await alice.goto(`/atelier/collaboration?room=${room}&name=Alice`);
		await bob.goto(`/atelier/collaboration?room=${room}&name=Bob`);
		const viewport = alice.locator('[data-canvas-viewport]');
		await expect(alice.locator('[data-graph-stage]')).toBeVisible();
		await viewport.dispatchEvent('wheel', {
			ctrlKey: true,
			deltaY: -100,
			clientX: 100,
			clientY: 100,
		});
		await expect(alice.locator('[data-graph-stage]')).toHaveCSS('transform', /^matrix\(1\.1,/);
		const zoom = await alice
			.locator('[data-graph-stage]')
			.evaluate((node) => getComputedStyle(node).transform);
		const selected = alice.locator('[data-node-id="B"]');
		await selected.click();
		await selected.focus();
		const element = defined(await selected.elementHandle());
		const stage = defined(await alice.locator('[data-graph-stage]').elementHandle());
		const revision = await viewport.getAttribute('data-canvas-revision');
		await bob.getByRole('button', { name: 'Modifier Boîte A', exact: true }).click();
		await bob.getByRole('textbox', { name: 'Contenu A', exact: true }).fill('Mise à jour distante');
		await expect(alice.locator('[data-node-id="A"]')).toContainText('Mise à jour distante');
		await expect(viewport).not.toHaveAttribute('data-canvas-revision', revision ?? '');
		expect(
			await element.evaluate((node) => node.isConnected && document.activeElement === node),
		).toBe(true);
		expect(await stage.evaluate((node) => node.isConnected)).toBe(true);
		await expect(selected).toHaveAttribute('aria-pressed', 'true');
		await expect(alice.locator('[data-graph-stage]')).toHaveCSS('transform', zoom);
		await expect(alice.getByText('Measuring document…', { exact: true })).toHaveCount(0);
		const timings = await alice.evaluate(() =>
			performance.getEntriesByName('sequit:canvas-projection').map(({ duration }) => duration),
		);
		expect(timings).toHaveLength(1);
		const reportPath = info.outputPath('browser-projection.json');
		await writeFile(reportPath, JSON.stringify(timings));
		await info.attach('canvas-projection-ms', {
			path: reportPath,
			contentType: 'application/json',
		});
	} finally {
		await Promise.allSettled([aliceContext.close(), bobContext.close()]);
	}
});

test('a collapsed aggregate can be deleted without exposing or retargeting its hidden nodes', async ({
	page,
}) => {
	const room = `e2e-${crypto.randomUUID()}`;
	const source = collaborativeFixture(CollaborativeFixture.OpenGroup, room);
	const template = defined(source.nodes[0]);
	await seedRoom(room, CollaborativeFixture.OpenGroup, {
		...source,
		groups: source.groups.map((group) => ({ ...group, state: GroupState.Closed })),
		nodes: [
			...source.nodes,
			{
				kind: template.kind,
				natureId: template.natureId,
				id: 'C',
				markdown: 'Outside',
				layoutOrder: orderKey('a3'),
			},
		],
		relations: [
			{ id: 'one', from: 'C', to: 'A' },
			{ id: 'two', from: 'C', to: 'B' },
		],
	});
	await page.goto(`/atelier/collaboration?room=${room}`);
	await expect(page.locator('[data-node-id]')).toHaveCount(1);
	await expect(page.getByRole('button', { name: 'Modifier Boîte A', exact: true })).toHaveCount(0);
	await expect(page.getByLabel('Relations').getByRole('listitem')).toHaveCount(1);
	await page.getByRole('button', { name: 'Modifier Relation one', exact: true }).click();
	await expect(page.getByLabel('Destination de one', { exact: true })).toBeDisabled();
	await page.getByRole('button', { name: 'Supprimer la relation one', exact: true }).click();
	await expect(page.getByLabel('Relations').getByRole('listitem')).toHaveCount(0);
	await page.getByRole('button', { name: 'Modifier Groupe G', exact: true }).click();
	await page.getByRole('button', { name: 'Déplier G', exact: true }).click();
	await expect(page.locator('[data-node-id]')).toHaveCount(3);
	await expect(page.getByLabel('Relations').getByRole('listitem')).toHaveCount(0);
});
