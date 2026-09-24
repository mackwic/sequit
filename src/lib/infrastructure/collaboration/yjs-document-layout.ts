import type * as Y from 'yjs';

import {
	LAYOUT_BIASES,
	LAYOUT_DIRECTIONS,
	type LayoutConfiguration,
	layoutConfiguration,
} from '../../core/document/logic-document';
import { type ReadContext, YjsLiveDocumentDiagnosticCode } from './yjs-document-result';
import { readString } from './yjs-field-readers';

export function readSharedLayout(
	meta: Y.Map<unknown>,
	context: ReadContext,
): LayoutConfiguration | undefined {
	const layoutDirection = readString(meta.get('layoutDirection'), ['layout', 'direction'], context);
	const layoutBias = readString(meta.get('layoutBias'), ['layout', 'bias'], context);
	const direction = LAYOUT_DIRECTIONS.find((candidate) => candidate === layoutDirection);
	const bias = LAYOUT_BIASES.find((candidate) => candidate === layoutBias);
	if (layoutDirection !== undefined && direction === undefined)
		context.diagnostics.push({
			code: YjsLiveDocumentDiagnosticCode.Invalid,
			message: `Unsupported layout direction: ${layoutDirection}`,
			path: ['layout', 'direction'],
		});
	if (layoutBias !== undefined && bias === undefined)
		context.diagnostics.push({
			code: YjsLiveDocumentDiagnosticCode.Invalid,
			message: `Unsupported layout bias: ${layoutBias}`,
			path: ['layout', 'bias'],
		});
	let layout: LayoutConfiguration | undefined;
	if (direction !== undefined && bias !== undefined) layout = layoutConfiguration(direction, bias);
	const recognizedValues = direction !== undefined && bias !== undefined;
	if (recognizedValues && layout === undefined)
		context.diagnostics.push({
			code: YjsLiveDocumentDiagnosticCode.Invalid,
			message: `Layout bias ${bias} is incompatible with direction ${direction}`,
			path: ['layout', 'bias'],
		});
	return layout;
}
