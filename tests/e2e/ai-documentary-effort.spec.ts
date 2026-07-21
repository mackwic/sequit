import { expect, test } from '@playwright/test';

test.describe('AI for documentary effort', () => {
	test('opens the real document and renders its connected dependency graph', async ({ page }) => {
		await page.goto('/examples/ai-documentary-effort');

		await expect(page.locator('[data-status="connected"]')).toBeVisible();
		await expect(page.locator('[data-node-id]')).toHaveCount(24);
		await expect(page.locator('[data-group-id]')).toHaveCount(2);
		await expect(page.locator('[data-junction-id="word-ui-options"]')).toHaveCount(1);
		await expect(page.locator('[data-relation-id]')).toHaveCount(20);
		await expect(page.locator('[data-node-id="reduce-documentary-effort"]')).toContainText(
			'Apply AI to reduce the documentary effort on the whole pipeline',
		);
		await expect(page.locator('[data-group-id="data-team"]')).toContainText('Data team');
		await expect(
			page.locator(
				'[data-relation-id="data-team-to-ai-content-generation"][data-edge-from="data-team"][data-edge-to="ai-content-generation"]',
			),
		).toHaveCount(1);
		await expect(
			page.locator(
				'[data-relation-id="word-ui-options-to-familiar-word-ui"][data-edge-from="word-ui-options"][data-edge-to="familiar-word-ui"]',
			),
		).toHaveCount(1);

		const geometry = await page.evaluate(() => {
			function endpoint(id: string): HTMLElement {
				const value = document.querySelector<HTMLElement>(
					`[data-node-id="${id}"], [data-group-id="${id}"], [data-junction-id="${id}"]`,
				);
				if (!value) throw new Error(`Missing endpoint ${id}`);
				return value;
			}
			function onBoundary(x: number, y: number, element: HTMLElement): boolean {
				const left = Number.parseFloat(element.style.left);
				const top = Number.parseFloat(element.style.top);
				const right = left + Number.parseFloat(element.style.width);
				const bottom = top + Number.parseFloat(element.style.height);
				const tolerance = 0.1;
				const withinX = x >= left - tolerance && x <= right + tolerance;
				const withinY = y >= top - tolerance && y <= bottom + tolerance;
				return (
					(withinX && (Math.abs(y - top) < tolerance || Math.abs(y - bottom) < tolerance)) ||
					(withinY && (Math.abs(x - left) < tolerance || Math.abs(x - right) < tolerance))
				);
			}

			const connections = [...document.querySelectorAll<SVGPathElement>('[data-relation-id]')].map(
				(path) => {
					const from = path.dataset.edgeFrom;
					const to = path.dataset.edgeTo;
					const points = (path.getAttribute('d')?.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
					if (!from || !to || points.length < 4) return false;
					return (
						onBoundary(points[0] ?? 0, points[1] ?? 0, endpoint(from)) &&
						onBoundary(points[points.length - 2] ?? 0, points[points.length - 1] ?? 0, endpoint(to))
					);
				},
			);
			const useCases = endpoint('use-cases').getBoundingClientRect();
			const member = endpoint('traceable-edits').getBoundingClientRect();
			const dataTeam = endpoint('data-team');
			const aiContent = endpoint('ai-content-generation');
			const goal = endpoint('reduce-documentary-effort');
			return {
				allConnectionsTouchEndpoints: connections.every(Boolean),
				memberInsideGroup:
					member.left > useCases.left &&
					member.right < useCases.right &&
					member.top > useCases.top &&
					member.bottom < useCases.bottom,
				emptyGroupHasBounds: dataTeam.offsetWidth > 0 && dataTeam.offsetHeight > 0,
				bottomToTop:
					aiContent.offsetTop < dataTeam.offsetTop && goal.offsetTop < aiContent.offsetTop,
			};
		});

		expect(geometry).toEqual({
			allConnectionsTouchEndpoints: true,
			memberInsideGroup: true,
			emptyGroupHasBounds: true,
			bottomToTop: true,
		});
	});
});
