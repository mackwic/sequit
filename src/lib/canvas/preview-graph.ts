export const PREVIEW_STAGE = {
	width: 1100,
	height: 500,
	nodeWidth: 220,
	nodeHeight: 116
} as const;

export interface PreviewNode {
	id: string;
	nature: {
		label: string;
		color: string;
	};
	content: string;
	x: number;
	y: number;
}

interface PreviewEdge {
	from: PreviewNode['id'];
	to: PreviewNode['id'];
}

export interface PreviewConnection {
	from: PreviewNode['id'];
	to: PreviewNode['id'];
	path: string;
}

export const previewNodes: PreviewNode[] = [
	{
		id: 'validate-problem',
		nature: { label: 'Precondition', color: '#d99b34' },
		content: 'Validate the problem with ten pilot users.',
		x: 80,
		y: 192
	},
	{
		id: 'build-prototype',
		nature: { label: 'Action', color: '#39966c' },
		content: 'Build a collaborative browser prototype.',
		x: 440,
		y: 192
	},
	{
		id: 'launch-version',
		nature: { label: 'Goal', color: '#7557d6' },
		content: 'Launch the first version before September.',
		x: 800,
		y: 192
	}
];

const previewEdges: PreviewEdge[] = [
	{ from: 'validate-problem', to: 'build-prototype' },
	{ from: 'build-prototype', to: 'launch-version' }
];

const nodesById: Record<string, PreviewNode> = Object.fromEntries(
	previewNodes.map((node) => [node.id, node])
);

export const previewConnections: PreviewConnection[] = previewEdges.map((edge) => {
	const source = nodesById[edge.from];
	const target = nodesById[edge.to];

	if (!source || !target) {
		throw new Error(`Preview edge references an unknown node: ${edge.from} -> ${edge.to}`);
	}

	const startX = source.x + PREVIEW_STAGE.nodeWidth;
	const startY = source.y + PREVIEW_STAGE.nodeHeight / 2;
	const endX = target.x;
	const endY = target.y + PREVIEW_STAGE.nodeHeight / 2;
	const controlOffset = (endX - startX) / 2;

	return {
		...edge,
		path: `M ${startX} ${startY} C ${startX + controlOffset} ${startY}, ${endX - controlOffset} ${endY}, ${endX} ${endY}`
	};
});
