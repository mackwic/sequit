import { describe, expect, it, vi } from 'vitest';

import { EntityKind, entityRef } from '../../../../../src/app/web/ui/canvas/canvas-entity';
import {
	activateEntityByKeyboard,
	activateEntityByPointer,
	type CanvasEntitySelection,
} from '../../../../../src/app/web/ui/canvas/canvas-entity-events';

const relation = entityRef(EntityKind.Relation, 'team-to-generation');

function selection(): CanvasEntitySelection {
	return { selectEntity: vi.fn(() => true), toggleEntity: vi.fn(() => true) };
}

function pointerEvent(
	modifiers: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean } = {},
) {
	return {
		shiftKey: false,
		ctrlKey: false,
		metaKey: false,
		stopPropagation: vi.fn(),
		...modifiers,
	};
}

function keyEvent(code: string) {
	return { code, preventDefault: vi.fn(), stopPropagation: vi.fn() };
}

describe('pointer activation', () => {
	it('replaces the selection and keeps the canvas background out of the way', () => {
		const session = selection();
		const event = pointerEvent();

		activateEntityByPointer(session, relation, event);

		expect(session.selectEntity).toHaveBeenCalledWith(relation);
		expect(session.toggleEntity).not.toHaveBeenCalled();
		expect(event.stopPropagation).toHaveBeenCalled();
	});

	it.each(['shiftKey', 'ctrlKey', 'metaKey'] as const)(
		'toggles the entity when %s is held, as for every other entity kind',
		(modifier) => {
			const session = selection();

			activateEntityByPointer(session, relation, pointerEvent({ [modifier]: true }));

			expect(session.toggleEntity).toHaveBeenCalledWith(relation);
			expect(session.selectEntity).not.toHaveBeenCalled();
		},
	);
});

describe('keyboard activation', () => {
	it('toggles the entity on Space', () => {
		const session = selection();
		const event = keyEvent('Space');

		expect(activateEntityByKeyboard(session, relation, event)).toBe(true);
		expect(session.toggleEntity).toHaveBeenCalledWith(relation);
		expect(session.selectEntity).not.toHaveBeenCalled();
		expect(event.preventDefault).toHaveBeenCalled();
		expect(event.stopPropagation).toHaveBeenCalled();
	});

	it('confirms the entity on Enter', () => {
		const session = selection();
		const event = keyEvent('Enter');

		expect(activateEntityByKeyboard(session, relation, event)).toBe(true);
		expect(session.selectEntity).toHaveBeenCalledWith(relation);
		expect(session.toggleEntity).not.toHaveBeenCalled();
	});

	it('leaves any other key to its own handler', () => {
		const session = selection();
		const event = keyEvent('KeyE');

		expect(activateEntityByKeyboard(session, relation, event)).toBe(false);
		expect(session.selectEntity).not.toHaveBeenCalled();
		expect(session.toggleEntity).not.toHaveBeenCalled();
		expect(event.preventDefault).not.toHaveBeenCalled();
		expect(event.stopPropagation).not.toHaveBeenCalled();
	});
});
