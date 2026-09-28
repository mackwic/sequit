/**
 * What a canvas key press may act on, and which key presses the canvas may claim.
 * Every surface that listens on the canvas shares these definitions so that one
 * target is never both editable for the gestures and a control for the viewport.
 */
const EDITABLE_TARGET = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';
const NATIVE_CONTROL_TARGET = `button, a, ${EDITABLE_TARGET}`;

export function isEditableTarget(target: EventTarget | null): boolean {
	return target instanceof Element && target.closest(EDITABLE_TARGET) !== null;
}

/** Controls the browser owns: the canvas neither edits from one nor pans over one. */
export function isNativeControlTarget(target: EventTarget | null): boolean {
	return target instanceof Element && target.closest(NATIVE_CONTROL_TARGET) !== null;
}

/** Nobody else has already answered this key, and it is a real press rather than a repeat. */
export function isUnclaimedKeyboardEvent(event: KeyboardEvent): boolean {
	const settled = event.defaultPrevented || event.repeat || event.isComposing;
	return !settled;
}

/** The canvas only owns plain keys: any modifier belongs to the browser or to the editor. */
export function isUnmodifiedKeyboardEvent(event: KeyboardEvent): boolean {
	const modified = event.ctrlKey || event.metaKey || event.altKey || event.shiftKey;
	return isUnclaimedKeyboardEvent(event) && !modified;
}
