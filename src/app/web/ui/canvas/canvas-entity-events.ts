import type { EntityRef } from './canvas-entity';

/** The selection surface every canvas entity is activated against. */
export interface CanvasEntitySelection {
	readonly selectEntity: (ref: EntityRef) => boolean;
	readonly toggleEntity: (ref: EntityRef) => boolean;
}

interface PointerActivation {
	readonly shiftKey: boolean;
	readonly ctrlKey: boolean;
	readonly metaKey: boolean;
	stopPropagation(): void;
}

interface KeyboardActivation {
	readonly code: string;
	preventDefault(): void;
	stopPropagation(): void;
}

/** Replaces the selection, or toggles the entity when Shift, Ctrl or Meta is held. */
export function activateEntityByPointer(
	selection: CanvasEntitySelection,
	ref: EntityRef,
	event: PointerActivation,
): void {
	event.stopPropagation();
	if (event.shiftKey || event.ctrlKey || event.metaKey) selection.toggleEntity(ref);
	else selection.selectEntity(ref);
}

/**
 * Space toggles the entity and Enter confirms it, which is how a relation, a group
 * and a junction are reached from the keyboard. Any other key is left to its own
 * handler; the return value reports whether the key was consumed.
 */
export function activateEntityByKeyboard(
	selection: CanvasEntitySelection,
	ref: EntityRef,
	event: KeyboardActivation,
): boolean {
	if (event.code !== 'Space' && event.code !== 'Enter') return false;
	event.preventDefault();
	event.stopPropagation();
	if (event.code === 'Space') selection.toggleEntity(ref);
	else selection.selectEntity(ref);
	return true;
}
