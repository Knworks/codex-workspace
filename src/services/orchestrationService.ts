import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { resolveCodexPaths } from './workspaceStatus';

export const ORCHESTRATION_SCHEMA_VERSION = 1;
export const ORCHESTRATION_DIRECTORY_NAME = 'orchestrations';

export type OrchestrationCardType =
	| 'start'
	| 'agentTask'
	| 'review'
	| 'output';

export type OrchestrationAgentSource = 'built-in' | 'user' | 'project' | '';

type PositionedNode = {
	nodeId: string;
	cardType: OrchestrationCardType;
	x: number;
	y: number;
};

export type StartNode = PositionedNode & {
	cardType: 'start';
	title: string;
	goal: string;
};

export type AgentTaskNode = PositionedNode & {
	cardType: 'agentTask';
	agentName: string;
	agentSource?: OrchestrationAgentSource;
	role: string;
	summary: string;
	instruction: string;
	outputContract: string;
	handoffMessage: string;
	doneCriteria: string;
	model: string;
	sandboxMode: string;
	reasoningEffort: string;
};

export type ReviewNode = PositionedNode & {
	cardType: 'review';
	agentName: string;
	role: string;
	summary: string;
	instruction: string;
	outputContract: string;
};

export type OutputNode = PositionedNode & {
	cardType: 'output';
	title: string;
	outputFormat: string;
};

export type OrchestrationNode =
	| StartNode
	| AgentTaskNode
	| ReviewNode
	| OutputNode;

export type OrchestrationEdge = {
	edgeId: string;
	sourceNodeId: string;
	targetNodeId: string;
};

export type OrchestrationWorkflow = {
	version: number;
	workflowId: string;
	name: string;
	description: string;
	nodes: OrchestrationNode[];
	edges: OrchestrationEdge[];
	createdAt: string;
	updatedAt: string;
};

export type OrchestrationWorkflowSummary = Pick<
	OrchestrationWorkflow,
	'workflowId' | 'name' | 'description' | 'updatedAt'
>;

export type OrchestrationTemplateId =
	| 'parallel-review'
	| 'research-plan'
	| 'research-merge'
	| 'design-test';

export type OrchestrationTemplate = {
	id: OrchestrationTemplateId;
	label: string;
	description: string;
};

export type WorkflowIssue = {
	code: string;
	message: string;
	nodeId?: string;
	edgeId?: string;
};

export type WorkflowValidationResult = {
	errors: WorkflowIssue[];
	warnings: WorkflowIssue[];
};

export const ORCHESTRATION_TEMPLATES: OrchestrationTemplate[] = [
	{
		id: 'parallel-review',
		label: '並列レビュー',
		description: 'Start、複数 Agent Task、Output で多角的レビューを行います。',
	},
	{
		id: 'research-plan',
		label: '調査から実装計画',
		description: '調査結果を実装計画へつなげる流れを作ります。',
	},
	{
		id: 'research-merge',
		label: '調査2本から統合',
		description: '2 本の調査結果を統合して結論をまとめます。',
	},
	{
		id: 'design-test',
		label: '設計からテスト観点',
		description: '設計のあとにレビューを通してテスト観点を整理します。',
	},
];

function createId(prefix: string): string {
	return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

function createStartNode(
	nodeId: string,
	x: number,
	y: number,
	goal: string,
): StartNode {
	return {
		nodeId,
		cardType: 'start',
		title: 'Start',
		goal,
		x,
		y,
	};
}

function createAgentTaskNode(
	nodeId: string,
	x: number,
	y: number,
	agentName: string,
	role: string,
	summary: string,
	instruction: string,
	outputContract: string,
): AgentTaskNode {
	return {
		nodeId,
		cardType: 'agentTask',
		agentName,
		agentSource: '',
		role,
		summary,
		instruction,
		outputContract,
		handoffMessage: '',
		doneCriteria: '',
		model: '',
		sandboxMode: '',
		reasoningEffort: '',
		x,
		y,
	};
}

function createReviewNode(
	nodeId: string,
	x: number,
	y: number,
	agentName: string,
	instruction: string,
	outputContract: string,
): ReviewNode {
	return {
		nodeId,
		cardType: 'review',
		agentName,
		role: 'Review',
		summary: '成果物のレビュー',
		instruction,
		outputContract,
		x,
		y,
	};
}

function createOutputNode(
	nodeId: string,
	x: number,
	y: number,
	outputFormat: string,
): OutputNode {
	return {
		nodeId,
		cardType: 'output',
		title: 'Output',
		outputFormat,
		x,
		y,
	};
}

function createEdge(
	edgeId: string,
	sourceNodeId: string,
	targetNodeId: string,
): OrchestrationEdge {
	return {
		edgeId,
		sourceNodeId,
		targetNodeId,
	};
}

function pickAgentName(
	availableAgents: string[],
	index: number,
	fallback: string,
): string {
	return availableAgents[index] ?? fallback;
}

export function createEmptyWorkflow(
	name = 'New orchestration',
	nowIso = new Date().toISOString(),
): OrchestrationWorkflow {
	const startId = createId('start');
	const outputId = createId('output');
	return {
		version: ORCHESTRATION_SCHEMA_VERSION,
		workflowId: createId('workflow'),
		name,
		description: '',
		nodes: [
			createStartNode(startId, 80, 180, ''),
			createOutputNode(outputId, 760, 180, ''),
		],
		edges: [createEdge(createId('edge'), startId, outputId)],
		createdAt: nowIso,
		updatedAt: nowIso,
	};
}

export function createWorkflowFromTemplate(
	templateId: OrchestrationTemplateId,
	availableAgents: string[] = [],
	nowIso = new Date().toISOString(),
): OrchestrationWorkflow {
	const workflow = createEmptyWorkflow(
		ORCHESTRATION_TEMPLATES.find((template) => template.id === templateId)?.label
			?? 'New orchestration',
		nowIso,
	);
	const startNode = workflow.nodes.find(
		(node): node is StartNode => node.cardType === 'start',
	);
	const outputNode = workflow.nodes.find(
		(node): node is OutputNode => node.cardType === 'output',
	);
	if (!startNode || !outputNode) {
		return workflow;
	}
	startNode.goal = 'Codex へ渡す作業フローを組み立てる。';
	outputNode.outputFormat = '最終結果、主要なリスク、次のアクションを箇条書きで返す。';
	workflow.edges = [];

	if (templateId === 'parallel-review') {
		const taskA = createAgentTaskNode(
			createId('agent'),
			320,
			80,
			pickAgentName(availableAgents, 0, 'pr_explorer'),
			'変更範囲の調査',
			'差分と関連コードを調べる',
			'変更範囲と影響箇所を調査してください。',
			'変更範囲、影響範囲、追加確認事項',
		);
		const taskB = createAgentTaskNode(
			createId('agent'),
			320,
			280,
			pickAgentName(availableAgents, 1, 'reviewer'),
			'正しさとテスト観点のレビュー',
			'品質観点のレビューを行う',
			'正しさ、セキュリティ、テスト不足をレビューしてください。',
			'重大な問題、修正推奨、追加確認事項',
		);
		workflow.nodes = [startNode, taskA, taskB, outputNode];
		workflow.edges = [
			createEdge(createId('edge'), startNode.nodeId, taskA.nodeId),
			createEdge(createId('edge'), startNode.nodeId, taskB.nodeId),
			createEdge(createId('edge'), taskA.nodeId, outputNode.nodeId),
			createEdge(createId('edge'), taskB.nodeId, outputNode.nodeId),
		];
		return workflow;
	}

	if (templateId === 'research-plan') {
		const research = createAgentTaskNode(
			createId('agent'),
			280,
			180,
			pickAgentName(availableAgents, 0, 'researcher'),
			'技術調査',
			'現状と制約を整理する',
			'関連実装と制約条件を調査してください。',
			'現状整理、制約、懸念点',
		);
		const planning = createAgentTaskNode(
			createId('agent'),
			520,
			180,
			pickAgentName(availableAgents, 1, 'planner'),
			'実装計画',
			'調査結果を計画へ落とす',
			'調査結果をもとに実装計画へ落とし込んでください。',
			'実装順序、依存関係、検証方針',
		);
		workflow.nodes = [startNode, research, planning, outputNode];
		workflow.edges = [
			createEdge(createId('edge'), startNode.nodeId, research.nodeId),
			createEdge(createId('edge'), research.nodeId, planning.nodeId),
			createEdge(createId('edge'), planning.nodeId, outputNode.nodeId),
		];
		return workflow;
	}

	if (templateId === 'research-merge') {
		const researchA = createAgentTaskNode(
			createId('agent'),
			320,
			80,
			pickAgentName(availableAgents, 0, 'researcher_a'),
			'調査 A',
			'パターン A を調査する',
			'選択肢 A の技術調査をしてください。',
			'メリット、デメリット、リスク',
		);
		const researchB = createAgentTaskNode(
			createId('agent'),
			320,
			280,
			pickAgentName(availableAgents, 1, 'researcher_b'),
			'調査 B',
			'パターン B を調査する',
			'選択肢 B の技術調査をしてください。',
			'メリット、デメリット、リスク',
		);
		workflow.nodes = [startNode, researchA, researchB, outputNode];
		workflow.edges = [
			createEdge(createId('edge'), startNode.nodeId, researchA.nodeId),
			createEdge(createId('edge'), startNode.nodeId, researchB.nodeId),
			createEdge(createId('edge'), researchA.nodeId, outputNode.nodeId),
			createEdge(createId('edge'), researchB.nodeId, outputNode.nodeId),
		];
		return workflow;
	}

	const design = createAgentTaskNode(
		createId('agent'),
		280,
		180,
		pickAgentName(availableAgents, 0, 'designer'),
		'設計整理',
		'設計方針をまとめる',
		'実装前の設計方針を整理してください。',
		'設計方針、想定リスク、未確定事項',
	);
	const review = createReviewNode(
		createId('review'),
		520,
		180,
		pickAgentName(availableAgents, 1, 'tester'),
		'設計内容をレビューし、テスト観点を整理してください。',
		'レビュー結果、抜け漏れ、テスト観点',
	);
	workflow.nodes = [startNode, design, review, outputNode];
	workflow.edges = [
		createEdge(createId('edge'), startNode.nodeId, design.nodeId),
		createEdge(createId('edge'), design.nodeId, review.nodeId),
		createEdge(createId('edge'), review.nodeId, outputNode.nodeId),
	];
	return workflow;
}

export function getOrchestrationDirectory(
	codexDir = resolveCodexPaths().codexDir,
): string {
	return path.join(codexDir, ORCHESTRATION_DIRECTORY_NAME);
}

export function listSavedWorkflowSummaries(
	codexDir = resolveCodexPaths().codexDir,
): OrchestrationWorkflowSummary[] {
	const directory = getOrchestrationDirectory(codexDir);
	if (!fs.existsSync(directory)) {
		return [];
	}
	return fs.readdirSync(directory, { withFileTypes: true })
		.filter(
			(entry) =>
				entry.isFile() && path.extname(entry.name).toLocaleLowerCase() === '.json',
		)
		.map((entry) => {
			const workflow = loadWorkflowDefinition(
				path.basename(entry.name, '.json'),
				codexDir,
			);
			return {
				workflowId: workflow.workflowId,
				name: workflow.name,
				description: workflow.description,
				updatedAt: workflow.updatedAt,
			};
		})
		.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function saveWorkflowDefinition(
	workflow: OrchestrationWorkflow,
	codexDir = resolveCodexPaths().codexDir,
	nowIso = new Date().toISOString(),
): OrchestrationWorkflow {
	const normalized = normalizeWorkflowDefinition(workflow, nowIso);
	const directory = getOrchestrationDirectory(codexDir);
	fs.mkdirSync(directory, { recursive: true });
	fs.writeFileSync(
		path.join(directory, `${normalized.workflowId}.json`),
		`${JSON.stringify(normalized, null, 2)}\n`,
		'utf8',
	);
	return normalized;
}

export function loadWorkflowDefinition(
	workflowId: string,
	codexDir = resolveCodexPaths().codexDir,
): OrchestrationWorkflow {
	const filePath = path.join(
		getOrchestrationDirectory(codexDir),
		`${workflowId}.json`,
	);
	const contents = fs.readFileSync(filePath, 'utf8');
	let parsed: unknown;
	try {
		parsed = JSON.parse(contents) as unknown;
	} catch (error) {
		throw new Error(
			`Invalid orchestration JSON in ${path.basename(filePath)}: ${String(error)}`,
		);
	}
	return assertWorkflowDefinition(parsed);
}

export function validateWorkflowDefinition(
	workflow: OrchestrationWorkflow,
): WorkflowValidationResult {
	const errors: WorkflowIssue[] = [];
	const warnings: WorkflowIssue[] = [];
	const nodeIds = new Set<string>();
	const edgeIds = new Set<string>();
	const nodeMap = new Map(workflow.nodes.map((node) => [node.nodeId, node]));

	for (const node of workflow.nodes) {
		if (nodeIds.has(node.nodeId)) {
			errors.push({
				code: 'duplicateNode',
				message: `重複した nodeId です: ${node.nodeId}`,
				nodeId: node.nodeId,
			});
			continue;
		}
		nodeIds.add(node.nodeId);
		if (node.cardType === 'start' && !node.goal.trim()) {
			warnings.push({
				code: 'emptyGoal',
				message: 'Start カードの目的が未設定です。',
				nodeId: node.nodeId,
			});
		}
		if (node.cardType === 'output' && !node.outputFormat.trim()) {
			errors.push({
				code: 'emptyOutputFormat',
				message: 'Output カードの最終出力形式が未設定です。',
				nodeId: node.nodeId,
			});
		}
		if (
			(node.cardType === 'agentTask' || node.cardType === 'review')
			&& !node.agentName.trim()
		) {
			errors.push({
				code: 'emptyAgent',
				message: `${node.cardType === 'review' ? 'Review' : 'Agent Task'} カードの agent が未設定です。`,
				nodeId: node.nodeId,
			});
		}
		if (
			(node.cardType === 'agentTask' || node.cardType === 'review')
			&& !node.instruction.trim()
		) {
			errors.push({
				code: 'emptyInstruction',
				message: `${node.cardType === 'review' ? 'Review' : 'Agent Task'} カードの instruction が未設定です。`,
				nodeId: node.nodeId,
			});
		}
		if (
			(node.cardType === 'agentTask' || node.cardType === 'review')
			&& !node.outputContract.trim()
		) {
			errors.push({
				code: 'emptyOutputContract',
				message: `${node.cardType === 'review' ? 'Review' : 'Agent Task'} カードの output が未設定です。`,
				nodeId: node.nodeId,
			});
		}
	}

	const startCount = workflow.nodes.filter((node) => node.cardType === 'start').length;
	if (startCount !== 1) {
		errors.push({
			code: 'startCount',
			message:
				startCount === 0
					? 'Start カードが存在しません。'
					: 'Start カードは 1 つだけ配置してください。',
		});
	}
	const outputCount = workflow.nodes.filter((node) => node.cardType === 'output').length;
	if (outputCount === 0) {
		errors.push({
			code: 'missingOutput',
			message: 'Output カードが存在しません。',
		});
	}

	const outgoingCount = new Map<string, number>();
	for (const edge of workflow.edges) {
		if (edgeIds.has(edge.edgeId)) {
			errors.push({
				code: 'duplicateEdge',
				message: `重複した edgeId です: ${edge.edgeId}`,
				edgeId: edge.edgeId,
			});
			continue;
		}
		edgeIds.add(edge.edgeId);
		const source = nodeMap.get(edge.sourceNodeId);
		const target = nodeMap.get(edge.targetNodeId);
		if (!source || !target) {
			errors.push({
				code: 'danglingEdge',
				message: '接続元または接続先が存在しないコネクタがあります。',
				edgeId: edge.edgeId,
			});
			continue;
		}
		if (source.cardType === 'output') {
			errors.push({
				code: 'outputHasOutgoingEdge',
				message: 'Output カードは出力ポートを持てません。',
				edgeId: edge.edgeId,
				nodeId: source.nodeId,
			});
		}
		if (target.cardType === 'start') {
			errors.push({
				code: 'startHasIncomingEdge',
				message: 'Start カードは入力ポートを持てません。',
				edgeId: edge.edgeId,
				nodeId: target.nodeId,
			});
		}
		outgoingCount.set(
			edge.sourceNodeId,
			(outgoingCount.get(edge.sourceNodeId) ?? 0) + 1,
		);
	}

	if (workflow.nodes.length > 10) {
		warnings.push({
			code: 'nodeCount',
			message: 'カード数が 10 件を超えています。',
		});
	}
	if ([...outgoingCount.values()].some((count) => count > 5)) {
		warnings.push({
			code: 'parallelCount',
			message: '並列分岐数が 5 件を超えています。',
		});
	}
	if (hasCycle(workflow)) {
		errors.push({
			code: 'cycle',
			message: '循環参照があるためプロンプト生成できません。',
		});
	}

	return { errors, warnings };
}

export function generateWorkflowPrompt(
	workflow: OrchestrationWorkflow,
): { prompt: string; validation: WorkflowValidationResult } {
	const validation = validateWorkflowDefinition(workflow);
	if (validation.errors.length > 0) {
		return { prompt: '', validation };
	}

	const nodeMap = new Map(workflow.nodes.map((node) => [node.nodeId, node]));
	const startNode = workflow.nodes.find(
		(node): node is StartNode => node.cardType === 'start',
	);
	const outputNodes = workflow.nodes.filter(
		(node): node is OutputNode => node.cardType === 'output',
	);
	const agentNodes = workflow.nodes.filter(
		(node): node is AgentTaskNode | ReviewNode =>
			node.cardType === 'agentTask' || node.cardType === 'review',
	);
	const executionGroups = buildExecutionGroups(workflow)
		.map((group) => group.filter((node) => node.cardType !== 'start'))
		.filter((group) => group.length > 0);

	const lines: string[] = [
		'次の subagent workflow で作業してください。',
		'',
		'目的:',
		startNode?.goal.trim() || '目的未設定',
		'',
		'使用する agent:',
	];
	for (const node of agentNodes) {
		const summary =
			node.cardType === 'review'
				? 'レビュー担当'
				: node.summary.trim() || node.role.trim();
		lines.push(`- ${node.agentName}: ${summary}`);
	}
	if (agentNodes.length === 0) {
		lines.push('- なし');
	}

	lines.push('', '各 agent への依頼:');
	for (const node of agentNodes) {
		lines.push(`- ${describeNodeLabel(node)}`);
		lines.push(`  依頼: ${node.instruction.trim()}`);
		lines.push(`  期待出力: ${node.outputContract.trim()}`);
		if (node.cardType === 'agentTask' && node.handoffMessage.trim()) {
			lines.push(`  次への引き継ぎ: ${node.handoffMessage.trim()}`);
		}
		if (node.cardType === 'agentTask' && node.doneCriteria.trim()) {
			lines.push(`  完了条件: ${node.doneCriteria.trim()}`);
		}
	}

	lines.push('', '実行方法:');
	let stepNumber = 1;
	for (const group of executionGroups) {
		if (group.length === 1) {
			lines.push(
				`${stepNumber}. ${describeExecutionNode(group[0], workflow)} を実行してください。`,
			);
			} else {
				lines.push(
					`${stepNumber}. ${group
						.map((node) => describeExecutionNode(node, workflow))
						.join('、')} を並列に起動してください。`,
				);
			}
		stepNumber += 1;
	}
	lines.push(`${stepNumber}. 各 agent の結果を統合してください。`);

	lines.push('', '出力:');
	for (const node of outputNodes) {
		lines.push(`- ${node.outputFormat.trim()}`);
	}

	lines.push('', '注意事項:');
	lines.push('- 並列ステップは、全結果が揃ってから次に進んでください。');
	lines.push('- Review カードは入力元の成果物をレビュー対象として扱ってください。');
	lines.push('- 拡張機能側では agent を直接実行しません。必要な subagent 起動と結果統合は Codex 側で行ってください。');

	return {
		prompt: lines.join('\n'),
		validation,
	};
}

function describeNodeLabel(node: AgentTaskNode | ReviewNode): string {
	return `${node.agentName} (${node.role.trim() || (node.cardType === 'review' ? 'Review' : 'Task')})`;
}

function describeExecutionNode(
	node: OrchestrationNode,
	workflow: OrchestrationWorkflow,
): string {
	if (node.cardType === 'agentTask' || node.cardType === 'review') {
		return describeNodeLabel(node);
	}
	if (node.cardType === 'output') {
		const parents = workflow.edges
			.filter((edge) => edge.targetNodeId === node.nodeId)
			.map((edge) => edge.sourceNodeId);
		return parents.length > 0
			? `最終出力を ${node.title} にまとめる`
			: node.title;
	}
	return node.title;
}

function buildExecutionGroups(
	workflow: OrchestrationWorkflow,
): OrchestrationNode[][] {
	const nodeMap = new Map(workflow.nodes.map((node) => [node.nodeId, node]));
	const indegree = new Map<string, number>();
	const adjacency = new Map<string, string[]>();

	for (const node of workflow.nodes) {
		indegree.set(node.nodeId, 0);
		adjacency.set(node.nodeId, []);
	}

	for (const edge of workflow.edges) {
		if (!nodeMap.has(edge.sourceNodeId) || !nodeMap.has(edge.targetNodeId)) {
			continue;
		}
		adjacency.get(edge.sourceNodeId)?.push(edge.targetNodeId);
		indegree.set(
			edge.targetNodeId,
			(indegree.get(edge.targetNodeId) ?? 0) + 1,
		);
	}

	let current = workflow.nodes
		.filter((node) => (indegree.get(node.nodeId) ?? 0) === 0)
		.sort(compareNodes);
	const groups: OrchestrationNode[][] = [];

	while (current.length > 0) {
		groups.push(current);
		const nextIds = new Set<string>();
		for (const node of current) {
			for (const targetId of adjacency.get(node.nodeId) ?? []) {
				const nextIndegree = (indegree.get(targetId) ?? 0) - 1;
				indegree.set(targetId, nextIndegree);
				if (nextIndegree === 0) {
					nextIds.add(targetId);
				}
			}
		}
		current = [...nextIds]
			.map((nodeId) => nodeMap.get(nodeId))
			.filter((node): node is OrchestrationNode => Boolean(node))
			.sort(compareNodes);
	}

	return groups;
}

function compareNodes(left: OrchestrationNode, right: OrchestrationNode): number {
	if (left.x !== right.x) {
		return left.x - right.x;
	}
	if (left.y !== right.y) {
		return left.y - right.y;
	}
	return left.nodeId.localeCompare(right.nodeId);
}

function hasCycle(workflow: OrchestrationWorkflow): boolean {
	const adjacency = new Map<string, string[]>();
	const nodeIds = new Set(workflow.nodes.map((node) => node.nodeId));
	for (const node of workflow.nodes) {
		adjacency.set(node.nodeId, []);
	}
	for (const edge of workflow.edges) {
		if (!nodeIds.has(edge.sourceNodeId) || !nodeIds.has(edge.targetNodeId)) {
			continue;
		}
		adjacency.get(edge.sourceNodeId)?.push(edge.targetNodeId);
	}

	const visiting = new Set<string>();
	const visited = new Set<string>();

	const visit = (nodeId: string): boolean => {
		if (visiting.has(nodeId)) {
			return true;
		}
		if (visited.has(nodeId)) {
			return false;
		}
		visiting.add(nodeId);
		for (const nextId of adjacency.get(nodeId) ?? []) {
			if (visit(nextId)) {
				return true;
			}
		}
		visiting.delete(nodeId);
		visited.add(nodeId);
		return false;
	};

	for (const nodeId of adjacency.keys()) {
		if (visit(nodeId)) {
			return true;
		}
	}
	return false;
}

function normalizeWorkflowDefinition(
	workflow: OrchestrationWorkflow,
	nowIso: string,
): OrchestrationWorkflow {
	const normalized = assertWorkflowDefinition({
		...workflow,
		version: ORCHESTRATION_SCHEMA_VERSION,
		workflowId: workflow.workflowId || createId('workflow'),
		name: workflow.name.trim() || 'New orchestration',
		description: workflow.description ?? '',
		createdAt: workflow.createdAt || nowIso,
		updatedAt: nowIso,
	});
	return normalized;
}

function assertWorkflowDefinition(value: unknown): OrchestrationWorkflow {
	if (!value || typeof value !== 'object') {
		throw new Error('Workflow definition must be an object.');
	}
	const record = value as Record<string, unknown>;
	if (typeof record.workflowId !== 'string' || record.workflowId.trim() === '') {
		throw new Error('workflowId is required.');
	}
	if (typeof record.name !== 'string') {
		throw new Error('name is required.');
	}
	if (!Array.isArray(record.nodes)) {
		throw new Error('nodes must be an array.');
	}
	if (!Array.isArray(record.edges)) {
		throw new Error('edges must be an array.');
	}
	return {
		version:
			typeof record.version === 'number'
				? record.version
				: ORCHESTRATION_SCHEMA_VERSION,
		workflowId: record.workflowId,
		name: record.name,
		description:
			typeof record.description === 'string' ? record.description : '',
		nodes: record.nodes.map(assertNodeDefinition),
		edges: record.edges.map(assertEdgeDefinition),
		createdAt:
			typeof record.createdAt === 'string'
				? record.createdAt
				: new Date().toISOString(),
		updatedAt:
			typeof record.updatedAt === 'string'
				? record.updatedAt
				: new Date().toISOString(),
	};
}

function assertNodeDefinition(value: unknown): OrchestrationNode {
	if (!value || typeof value !== 'object') {
		throw new Error('Node must be an object.');
	}
	const record = value as Record<string, unknown>;
	const common = {
		nodeId: requireString(record.nodeId, 'nodeId'),
		cardType: requireString(record.cardType, 'cardType') as OrchestrationCardType,
		x: typeof record.x === 'number' ? record.x : 0,
		y: typeof record.y === 'number' ? record.y : 0,
	};
	if (common.cardType === 'start') {
		return {
			...common,
			cardType: 'start',
			title: stringOrDefault(record.title, 'Start'),
			goal: stringOrDefault(record.goal, ''),
		};
	}
	if (common.cardType === 'agentTask') {
		return {
			...common,
			cardType: 'agentTask',
			agentName: stringOrDefault(record.agentName, ''),
			agentSource: stringOrDefault(
				record.agentSource,
				'',
			) as OrchestrationAgentSource,
			role: stringOrDefault(record.role, ''),
			summary: stringOrDefault(record.summary, ''),
			instruction: stringOrDefault(record.instruction, ''),
			outputContract: stringOrDefault(record.outputContract, ''),
			handoffMessage: stringOrDefault(record.handoffMessage, ''),
			doneCriteria: stringOrDefault(record.doneCriteria, ''),
			model: stringOrDefault(record.model, ''),
			sandboxMode: stringOrDefault(record.sandboxMode, ''),
			reasoningEffort: stringOrDefault(record.reasoningEffort, ''),
		};
	}
	if (common.cardType === 'review') {
		return {
			...common,
			cardType: 'review',
			agentName: stringOrDefault(record.agentName, ''),
			role: stringOrDefault(record.role, 'Review'),
			summary: stringOrDefault(record.summary, ''),
			instruction: stringOrDefault(record.instruction, ''),
			outputContract: stringOrDefault(record.outputContract, ''),
		};
	}
	if (common.cardType === 'output') {
		return {
			...common,
			cardType: 'output',
			title: stringOrDefault(record.title, 'Output'),
			outputFormat: stringOrDefault(record.outputFormat, ''),
		};
	}
	throw new Error(`Unsupported cardType: ${String(record.cardType)}`);
}

function assertEdgeDefinition(value: unknown): OrchestrationEdge {
	if (!value || typeof value !== 'object') {
		throw new Error('Edge must be an object.');
	}
	const record = value as Record<string, unknown>;
	return {
		edgeId: requireString(record.edgeId, 'edgeId'),
		sourceNodeId: requireString(record.sourceNodeId, 'sourceNodeId'),
		targetNodeId: requireString(record.targetNodeId, 'targetNodeId'),
	};
}

function requireString(value: unknown, fieldName: string): string {
	if (typeof value !== 'string' || value.trim() === '') {
		throw new Error(`${fieldName} is required.`);
	}
	return value;
}

function stringOrDefault(value: unknown, fallback: string): string {
	return typeof value === 'string' ? value : fallback;
}
