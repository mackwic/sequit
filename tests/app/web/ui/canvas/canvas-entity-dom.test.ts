// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';

import { entityKey, EntityKind } from '../../../../../src/app/web/ui/canvas/canvas-entity';
import {
	canvasEntityElement,
	canvasSelectionBounds,
	focusCanvasEntity,
} from '../../../../../src/app/web/ui/canvas/canvas-entity-dom';

const node = entityKey(EntityKind.Node, 'decision');
const relation = entityKey(EntityKind.Relation, 'decision-to-option');
const absent = entityKey(EntityKind.Group, 'unrendered');

function rendered(key: string, box?: DOMRect): HTMLElement {
	document.body.insertAdjacentHTML(
		'beforeend',
		`<button data-canvas-entity-key="${key}"></button>`,
	);
	const element = document.body.querySelector<HTMLElement>(`[data-canvas-entity-key="${key}"]`);
	if (element === null) throw new Error(`The stage has no ${key}`);
	if (box !== undefined)
		Object.defineProperty(element, 'getBoundingClientRect', { value: () => box });
	return element;
}

describe('canvas entity lookup', () => {
	beforeEach(() => {
		document.body.innerHTML = '';
	});

	it('finds the rendered element of an entity, and nothing for an unrendered one', () => {
		const target = rendered(node);
		rendered(relation);

		expect(canvasEntityElement(document.body, node)).toBe(target);
		expect(canvasEntityElement(document.body, absent)).toBeUndefined();
	});

	it('ignores the elements that do not carry an entity key', () => {
		document.body.insertAdjacentHTML('beforeend', '<div id="grid"></div>');
		rendered(node);

		expect(
			canvasEntityElement(document.body, entityKey(EntityKind.Junction, 'word-ui')),
		).toBeUndefined();
	});

	it('focuses an entity in place and reports an entity that is not on the stage', () => {
		const target = rendered(node);

		expect(focusCanvasEntity(document.body, node)).toBe(true);
		expect(document.activeElement).toBe(target);
		expect(focusCanvasEntity(document.body, absent)).toBe(false);
	});
});

describe('canvas selection bounds', () => {
	beforeEach(() => {
		document.body.innerHTML = '';
	});

	it('encloses every selected entity whatever its position on the stage', () => {
		rendered(node, new DOMRect(40, 60, 20, 20));
		rendered(relation, new DOMRect(10, 90, 15, 5));

		const bounds = canvasSelectionBounds(document.body, new Set([node, relation]));

		expect(bounds?.left).toBe(10);
		expect(bounds?.top).toBe(60);
		expect(bounds?.right).toBe(60);
		expect(bounds?.bottom).toBe(95);
		expect(bounds?.width).toBe(50);
		expect(bounds?.height).toBe(35);
	});

	it('leaves the selection out of its own bounds', () => {
		rendered(node, new DOMRect(0, 0, 10, 10));
		rendered(relation, new DOMRect(100, 100, 10, 10));

		const bounds = canvasSelectionBounds(document.body, new Set([node]));

		expect(bounds?.left).toBe(0);
		expect(bounds?.right).toBe(10);
	});

	it('has no box when nothing of the selection is on the stage', () => {
		rendered(node, new DOMRect(0, 0, 10, 10));

		expect(canvasSelectionBounds(document.body, new Set([absent]))).toBeUndefined();
		expect(canvasSelectionBounds(document.body, new Set())).toBeUndefined();
	});
});
