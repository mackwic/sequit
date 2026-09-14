import { writeFile } from 'node:fs/promises';

import { expect, type Page, test } from '@playwright/test';

import { BinaryTreeScenarioBuilder } from '../../../../src/app/workshop/fixtures/layout-performance/builders/binary-tree-scenario';
import { defined } from '../../../../src/lib/core/document/logic-document';
import { CollaborativeFixture } from '../../../support/fixtures/collaborative-document';
import { seedRoom } from './collaboration-room';

async function markTimestamp(page: Page, name: string): Promise<number> {
	return page.evaluate((markName) => {
		const mark = performance.getEntriesByName(markName)[0];
		if (mark === undefined) throw new Error(`Missing browser timing mark: ${markName}`);
		return performance.timeOrigin + mark.startTime;
	}, name);
}

/** Browser observation, not a replacement for calibrated isolated engine performance gates. */
test('records real remote projections for a 1000-node document', async ({ browser }, info) => {
	// Eight edits on two instrumented pages include Playwright tracing and context cleanup.
	test.setTimeout(60_000);
	const room = `e2e-${crypto.randomUUID()}`;
	const source = new BinaryTreeScenarioBuilder().buildSnapshot(1000).document;
	await seedRoom(room, CollaborativeFixture.TwoBoxes, source);
	const node = defined(source.nodes[0]);
	const presenting = await browser.newContext();
	const observing = await browser.newContext();
	try {
		const presenter = await presenting.newPage();
		const observer = await observing.newPage();
		await presenter.goto(`/atelier/collaboration?room=${room}&name=Présentation`);
		await observer.goto(`/atelier/collaboration?room=${room}&name=Observation`);
		await expect(observer.locator('[data-node-id]')).toHaveCount(1000);
		await presenter.getByRole('button', { name: `Modifier Boîte ${node.id}`, exact: true }).click();
		const editor = presenter.getByRole('textbox', { name: `Contenu ${node.id}`, exact: true });
		await editor.evaluate((element) => {
			// Quill handles beforeinput itself and may cancel the native input event.
			element.addEventListener(
				'beforeinput',
				() => {
					performance.clearMarks('sequit:test:input');
					performance.mark('sequit:test:input');
				},
				true,
			);
		});
		const observedNode = observer.locator(`[data-node-id="${node.id}"]`);
		await observedNode.evaluate((element) => {
			let preceding = element.textContent;
			new MutationObserver(() => {
				if (element.textContent === preceding) return;
				preceding = element.textContent;
				performance.clearMarks('sequit:test:remote-dom');
				performance.mark('sequit:test:remote-dom');
			}).observe(element, { childList: true, characterData: true, subtree: true });
		});
		const samples: number[] = [];
		const remoteDomSamples: number[] = [];
		for (let index = 0; index < 8; index += 1) {
			const text = `Observation ${index}`;
			await editor.fill(text);
			await expect(observedNode).toContainText(text);
			const duration = await observer.evaluate(
				() => performance.getEntriesByName('sequit:canvas-projection')[0]?.duration,
			);
			samples.push(defined(duration));
			// timeOrigin makes the two local browser contexts comparable; Playwright polling is excluded.
			const inputAt = await markTimestamp(presenter, 'sequit:test:input');
			const observedAt = await markTimestamp(observer, 'sequit:test:remote-dom');
			remoteDomSamples.push(observedAt - inputAt);
		}
		const environment = await observer.evaluate(() => ({
			userAgent: navigator.userAgent,
			concurrency: navigator.hardwareConcurrency,
		}));
		const reportPath = info.outputPath('browser-projection.json');
		await writeFile(
			reportPath,
			JSON.stringify({
				scenario: 'binary-tree',
				nodes: 1000,
				participants: 2,
				metric: 'DOM measurement and projection milliseconds',
				samples,
				remoteDomMetric:
					'Presenter beforeinput event to observer DOM mutation milliseconds; excludes paint',
				remoteDomSamples,
				trace: info.project.use.trace,
				environment,
			}),
		);
		await info.attach('1000-node-browser-projection', {
			path: reportPath,
			contentType: 'application/json',
		});
		await expect(observer.locator('[data-node-id]')).toHaveCount(1000);
	} finally {
		await Promise.allSettled([presenting.close(), observing.close()]);
	}
});
