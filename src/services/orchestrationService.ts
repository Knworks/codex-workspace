import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { resolveCodexPaths } from './workspaceStatus';

export const ORCHESTRATION_SCHEMA_VERSION = 2;
export const ORCHESTRATION_DIRECTORY_NAME = 'orchestrations';

export type OrchestrationCardType =
	| 'workflow'
	| 'agent'
	| 'loop';

type PositionedNode = {
	nodeId: string;
	cardType: OrchestrationCardType;
	x: number;
	y: number;
};

export type WorkflowNode = PositionedNode & {
	cardType: 'workflow';
};

export type AgentNode = PositionedNode & {
	cardType: 'agent';
	order: number;
	agentName: string;
	purpose: string;
	input: string;
	expectedOutput: string;
	doneCriteria: string;
};

export type LoopNode = PositionedNode & {
	cardType: 'loop';
	maxAttempts: number;
	acceptanceCriteria: string;
};

export type OrchestrationNode =
	| WorkflowNode
	| AgentNode
	| LoopNode;

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
	finalOutputFormat: string;
	nodes: OrchestrationNode[];
	edges: OrchestrationEdge[];
	createdAt: string;
	updatedAt: string;
};

export type OrchestrationWorkflowSummary = Pick<
	OrchestrationWorkflow,
	'workflowId' | 'name' | 'description' | 'updatedAt'
>;

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

type ResolvedLoop = {
	loop: LoopNode;
	inAgent: AgentNode;
	outAgent: AgentNode;
};

type PromptLocale = 'ja' | 'en';

type PromptStrings = {
	mainRoleTitle: string;
	mainRoleBody: string[];
	policyTitle: string;
	policyBody: string[];
	agentListTitle: string;
	loopTitle: string;
	outputFormatTitle: string;
	requestTitle: string;
	stepsTitle: string;
	outputTitle: string;
	endConditionsTitle: string;
	agentListNote: string;
	agentTableHeaders: string[];
	loopTableHeaders: string[];
	requestTableHeaders: string[];
	endTableHeaders: string[];
	requestRows: string[][];
	defaultReportBullets: string[];
	noLoopRow: string[];
	noAgentRow: string[];
	outputFallback: string;
	endSuccessLabel: string;
	endSuccessAction: string;
	endLoopLabel: string;
	endLoopAction: string;
	stepLines: string[];
	fallbackName: string;
	workflowNameRequired: string;
	duplicateNodeId: (nodeId: string) => string;
	duplicateEdgeId: (edgeId: string) => string;
	danglingEdge: string;
	workflowNodeMissing: string;
	workflowNodeMultiple: string;
	agentMissing: string;
	agentNameMissing: string;
	agentOrderInvalid: string;
	agentOrderDuplicate: string;
	loopAttemptsInvalid: string;
	loopCriteriaMissing: string;
	workflowIncomingForbidden: string;
	workflowToAgentOnly: string;
	agentConnectionInvalid: string;
	loopConnectionInvalid: string;
	loopIncomingRequired: string;
	loopOutgoingRequired: string;
	loopOrderInvalid: string;
	unreachableNode: string;
	cycleDetected: string;
};

function createId(prefix: string): string {
	return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

function createWorkflowNode(
	nodeId: string,
	x: number,
	y: number,
): WorkflowNode {
	return {
		nodeId,
		cardType: 'workflow',
		x,
		y,
	};
}

function createAgentNode(
	nodeId: string,
	x: number,
	y: number,
	order: number,
	agentName = '',
): AgentNode {
	return {
		nodeId,
		cardType: 'agent',
		order,
		agentName,
		purpose: '',
		input: '',
		expectedOutput: '',
		doneCriteria: '',
		x,
		y,
	};
}

function createLoopNode(
	nodeId: string,
	x: number,
	y: number,
	maxAttempts = 3,
): LoopNode {
	return {
		nodeId,
		cardType: 'loop',
		maxAttempts,
		acceptanceCriteria: '',
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

export function createEmptyWorkflow(
	name = '',
	nowIso = new Date().toISOString(),
): OrchestrationWorkflow {
	return {
		version: ORCHESTRATION_SCHEMA_VERSION,
		workflowId: createId('workflow'),
		name,
		description: '',
		finalOutputFormat: '',
		nodes: [createWorkflowNode(createId('workflow-node'), 80, 180)],
		edges: [],
		createdAt: nowIso,
		updatedAt: nowIso,
	};
}

export function getOrchestrationDirectory(
	codexDir = resolveCodexPaths().codexDir,
): string {
	return path.join(codexDir, '.codex-workspace', ORCHESTRATION_DIRECTORY_NAME);
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

export function deleteWorkflowDefinition(
	workflowId: string,
	codexDir = resolveCodexPaths().codexDir,
): void {
	const filePath = path.join(
		getOrchestrationDirectory(codexDir),
		`${workflowId}.json`,
	);
	if (!fs.existsSync(filePath)) {
		throw new Error(`Workflow not found: ${workflowId}`);
	}
	fs.unlinkSync(filePath);
}

export function validateWorkflowDefinition(
	workflow: OrchestrationWorkflow,
	language?: string,
): WorkflowValidationResult {
	const locale = language ? resolvePromptLocale(language) : 'ja';
	const strings = getPromptStrings(locale);
	const errors: WorkflowIssue[] = [];
	const warnings: WorkflowIssue[] = [];
	const nodeIds = new Set<string>();
	const edgeIds = new Set<string>();
	const nodeMap = new Map(workflow.nodes.map((node) => [node.nodeId, node]));
	const workflowNodes = workflow.nodes.filter(
		(node): node is WorkflowNode => node.cardType === 'workflow',
	);
	const agentNodes = getAgentNodes(workflow);
	const loopNodes = workflow.nodes.filter(
		(node): node is LoopNode => node.cardType === 'loop',
	);
	const orderSet = new Set<number>();

	if (!workflow.name.trim()) {
		errors.push({
			code: 'emptyWorkflowName',
			message: strings.workflowNameRequired,
			nodeId: workflowNodes[0]?.nodeId,
		});
	}

	for (const node of workflow.nodes) {
		if (nodeIds.has(node.nodeId)) {
			errors.push({
				code: 'duplicateNode',
				message: strings.duplicateNodeId(node.nodeId),
				nodeId: node.nodeId,
			});
			continue;
		}
		nodeIds.add(node.nodeId);
		if (node.cardType === 'agent') {
			if (!node.agentName.trim()) {
				errors.push({
					code: 'emptyAgent',
					message: strings.agentNameMissing,
					nodeId: node.nodeId,
				});
			}
			if (!Number.isInteger(node.order) || node.order < 1) {
				errors.push({
					code: 'invalidAgentOrder',
					message: strings.agentOrderInvalid,
					nodeId: node.nodeId,
				});
			} else if (orderSet.has(node.order)) {
				errors.push({
					code: 'duplicateAgentOrder',
					message: strings.agentOrderDuplicate,
					nodeId: node.nodeId,
				});
			} else {
				orderSet.add(node.order);
			}
		}
		if (node.cardType === 'loop') {
			if (!Number.isInteger(node.maxAttempts) || node.maxAttempts < 1) {
				errors.push({
					code: 'invalidLoopAttempts',
					message: strings.loopAttemptsInvalid,
					nodeId: node.nodeId,
				});
			}
			if (!node.acceptanceCriteria.trim()) {
				warnings.push({
					code: 'emptyAcceptanceCriteria',
					message: strings.loopCriteriaMissing,
					nodeId: node.nodeId,
				});
			}
		}
	}

	if (workflowNodes.length === 0) {
		errors.push({
			code: 'missingWorkflowNode',
			message: strings.workflowNodeMissing,
		});
	}
	if (workflowNodes.length > 1) {
		errors.push({
			code: 'multipleWorkflowNodes',
			message: strings.workflowNodeMultiple,
		});
	}
	if (agentNodes.length === 0) {
		errors.push({
			code: 'missingAgent',
			message: strings.agentMissing,
		});
	}

	const incoming = new Map<string, OrchestrationEdge[]>();
	const outgoing = new Map<string, OrchestrationEdge[]>();
	for (const node of workflow.nodes) {
		incoming.set(node.nodeId, []);
		outgoing.set(node.nodeId, []);
	}

	for (const edge of workflow.edges) {
		if (edgeIds.has(edge.edgeId)) {
			errors.push({
				code: 'duplicateEdge',
				message: strings.duplicateEdgeId(edge.edgeId),
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
				message: strings.danglingEdge,
				edgeId: edge.edgeId,
			});
			continue;
		}
		outgoing.get(source.nodeId)?.push(edge);
		incoming.get(target.nodeId)?.push(edge);

		if (source.cardType === 'workflow' && target.cardType !== 'agent') {
			errors.push({
				code: 'workflowToAgentOnly',
				message: strings.workflowToAgentOnly,
				edgeId: edge.edgeId,
			});
		}
		if (target.cardType === 'workflow') {
			errors.push({
				code: 'workflowIncomingForbidden',
				message: strings.workflowIncomingForbidden,
				edgeId: edge.edgeId,
			});
		}
		if (
			source.cardType === 'agent'
			&& target.cardType !== 'loop'
		) {
			errors.push({
				code: 'invalidAgentConnection',
				message: strings.agentConnectionInvalid,
				edgeId: edge.edgeId,
			});
		}
		if (source.cardType === 'loop' && target.cardType !== 'agent') {
			errors.push({
				code: 'invalidLoopConnection',
				message: strings.loopConnectionInvalid,
				edgeId: edge.edgeId,
			});
		}
	}

	for (const loopNode of loopNodes) {
		const loopIncoming = (incoming.get(loopNode.nodeId) ?? [])
			.map((edge) => nodeMap.get(edge.sourceNodeId))
			.filter((node): node is AgentNode => node?.cardType === 'agent');
		const loopOutgoing = (outgoing.get(loopNode.nodeId) ?? [])
			.map((edge) => nodeMap.get(edge.targetNodeId))
			.filter((node): node is AgentNode => node?.cardType === 'agent');
		if (loopIncoming.length !== 1) {
			errors.push({
				code: 'loopIncomingRequired',
				message: strings.loopIncomingRequired,
				nodeId: loopNode.nodeId,
			});
		}
		if (loopOutgoing.length !== 1) {
			errors.push({
				code: 'loopOutgoingRequired',
				message: strings.loopOutgoingRequired,
				nodeId: loopNode.nodeId,
			});
		}
		if (
			loopIncoming.length === 1
			&& loopOutgoing.length === 1
			&& loopIncoming[0].order >= loopOutgoing[0].order
		) {
			errors.push({
				code: 'invalidLoopOrder',
				message: strings.loopOrderInvalid,
				nodeId: loopNode.nodeId,
			});
		}
	}

	const workflowNode = workflowNodes[0];
	if (workflowNode) {
		const reachable = collectReachableNodeIds(workflowNode.nodeId, workflow.edges);
		for (const node of workflow.nodes) {
			if (node.nodeId === workflowNode.nodeId) {
				continue;
			}
			if (!reachable.has(node.nodeId)) {
				errors.push({
					code: 'unreachableNode',
					message: strings.unreachableNode,
					nodeId: node.nodeId,
				});
			}
		}
	}

	if (hasCycle(workflow)) {
		errors.push({
			code: 'cycle',
			message: strings.cycleDetected,
		});
	}

	return { errors, warnings };
}

export function generateWorkflowPrompt(
	workflow: OrchestrationWorkflow,
	language?: string,
): { prompt: string; validation: WorkflowValidationResult } {
	const locale = resolvePromptLocale(language);
	const validation = validateWorkflowDefinition(workflow, locale);
	if (validation.errors.length > 0) {
		return { prompt: '', validation };
	}
	const strings = getPromptStrings(locale);
	const workflowName = workflow.name.trim() || strings.fallbackName;
	const workflowDescription = workflow.description.trim();
	const finalOutputFormat = workflow.finalOutputFormat.trim();
	const agentNodes = getAgentNodes(workflow).sort((left, right) => left.order - right.order);
	const resolvedLoops = resolveLoops(workflow)
		.sort((left, right) => left.inAgent.order - right.inAgent.order);

	const lines: string[] = [
		'---',
		`name: ${quoteFrontmatterValue(workflowName)}`,
		`description: ${quoteFrontmatterValue(workflowDescription)}`,
		'---',
		'',
		`# ${workflowName}`,
		'',
		`## ${strings.mainRoleTitle}`,
		'',
		...strings.mainRoleBody,
		'',
		`## ${strings.policyTitle}`,
		'',
		...strings.policyBody.map((line) => `- ${line}`),
		'',
		`## ${strings.agentListTitle}`,
		'',
		strings.agentListNote,
		'',
		renderTable(
			strings.agentTableHeaders,
			agentNodes.length > 0
				? agentNodes.map((node) => [
					String(node.order),
					node.agentName || '-',
					node.purpose || '-',
					node.input || '-',
					node.expectedOutput || '-',
					node.doneCriteria || '-',
				])
				: [strings.noAgentRow],
		),
		'',
		`## ${strings.loopTitle}`,
		'',
		renderTable(
			strings.loopTableHeaders,
			resolvedLoops.length > 0
				? resolvedLoops.map(({ inAgent, outAgent, loop }) => [
					String(inAgent.order),
					inAgent.agentName || '-',
					String(outAgent.order),
					outAgent.agentName || '-',
					String(loop.maxAttempts),
					loop.acceptanceCriteria || '-',
				])
				: [strings.noLoopRow],
		),
		'',
		`## ${strings.requestTitle}`,
		'',
		renderTable(strings.requestTableHeaders, strings.requestRows),
		'',
		`## ${strings.stepsTitle}`,
		'',
		...strings.stepLines.map((line, index) => `${index + 1}. ${line}`),
	];

	if (finalOutputFormat) {
		lines.push(
			'',
			`## ${strings.outputFormatTitle}`,
			'',
			finalOutputFormat,
		);
	}
	lines.push(
		'',
		`## ${strings.outputTitle}`,
		'',
		strings.outputFallback,
		'',
	);
	for (const bullet of strings.defaultReportBullets) {
		lines.push(`- ${bullet}`);
	}

	lines.push(
		'',
		`## ${strings.endConditionsTitle}`,
		'',
		renderTable(strings.endTableHeaders, [
			[strings.endSuccessLabel, strings.endSuccessAction],
			[strings.endLoopLabel, strings.endLoopAction],
		]),
	);

	return {
		prompt: lines.join('\n'),
		validation,
	};
}

function renderTable(headers: string[], rows: string[][]): string {
	const normalizedRows = rows.map((row) => row.map((cell) => sanitizeTableCell(cell)));
	return [
		`| ${headers.join(' | ')} |`,
		`| ${headers.map(() => '---').join(' | ')} |`,
		...normalizedRows.map((row) => `| ${row.join(' | ')} |`),
	].join('\n');
}

function sanitizeTableCell(value: string): string {
	return value
		.replace(/\r?\n/g, '<br>')
		.replace(/\|/g, '\\|')
		.trim() || '-';
}

function quoteFrontmatterValue(value: string): string {
	return JSON.stringify(value);
}

function collectReachableNodeIds(
	startNodeId: string,
	edges: OrchestrationEdge[],
): Set<string> {
	const adjacency = new Map<string, string[]>();
	for (const edge of edges) {
		const list = adjacency.get(edge.sourceNodeId) ?? [];
		list.push(edge.targetNodeId);
		adjacency.set(edge.sourceNodeId, list);
	}
	const visited = new Set<string>();
	const queue = [startNodeId];
	while (queue.length > 0) {
		const current = queue.shift();
		if (!current || visited.has(current)) {
			continue;
		}
		visited.add(current);
		for (const next of adjacency.get(current) ?? []) {
			if (!visited.has(next)) {
				queue.push(next);
			}
		}
	}
	return visited;
}

function getWorkflowNode(
	workflow: OrchestrationWorkflow,
): WorkflowNode | undefined {
	return workflow.nodes.find(
		(node): node is WorkflowNode => node.cardType === 'workflow',
	);
}

function getAgentNodes(
	workflow: OrchestrationWorkflow,
): AgentNode[] {
	return workflow.nodes.filter(
		(node): node is AgentNode => node.cardType === 'agent',
	);
}

function resolveLoops(workflow: OrchestrationWorkflow): ResolvedLoop[] {
	const nodeMap = new Map(workflow.nodes.map((node) => [node.nodeId, node]));
	return workflow.nodes
		.filter((node): node is LoopNode => node.cardType === 'loop')
		.map((loop) => {
			const inEdge = workflow.edges.find((edge) => edge.targetNodeId === loop.nodeId);
			const outEdge = workflow.edges.find((edge) => edge.sourceNodeId === loop.nodeId);
			const inAgent = inEdge ? nodeMap.get(inEdge.sourceNodeId) : undefined;
			const outAgent = outEdge ? nodeMap.get(outEdge.targetNodeId) : undefined;
			if (inAgent?.cardType !== 'agent' || outAgent?.cardType !== 'agent') {
				return undefined;
			}
			return {
				loop,
				inAgent,
				outAgent,
			};
		})
		.filter((value): value is ResolvedLoop => Boolean(value));
}

function resolvePromptLocale(language?: string): PromptLocale {
	return (language ?? 'en').toLowerCase().startsWith('ja') ? 'ja' : 'en';
}

function getPromptStrings(locale: PromptLocale): PromptStrings {
	if (locale === 'ja') {
		return {
			mainRoleTitle: '🎯 目的',
			mainRoleBody: [
				'あなたは、オーケストレーターとして、メインエージェントからサブエージェントへの委譲、結果の受け取り、差し戻し判断、終了判定のみを管理する。',
				'',
				'各サブエージェントが実施すべき詳細作業は、各サブエージェントの定義または関連スキルに委譲する。',
			],
			policyTitle: '🧑‍✈️ 基本方針',
			policyBody: [
				'メインエージェントは、オーケストレーターとしてのみ振る舞うこと。',
				'メインエージェントは、自身で作業を行わず、作業を必ずサブエージェントへ委譲すること。',
				'メインエージェントが担当するのは、ユーザー依頼の整理、委譲、結果の受け取り、差し戻し判断、中間報告、最終結果の要約のみとすること。',
				'サブエージェントへの依頼は、目的、入力、期待する出力、担当完了条件に絞る。',
				'サブエージェント固有の作業手順は、各サブエージェントの定義または関連スキルに任せる。',
				'起動順は、サブエージェント一覧の `No` 昇順を基本とする。',
				'現在のサブエージェントに対応する差し戻し設定がある場合のみ、対応付けられた `確認 No` のサブエージェントを優先して起動すること。',
				'特別な出力指定がない場合でも、最後に必要な確認または担当作業が完了したらタスクを完了し、ユーザーへ報告すること。',
			],
			agentListTitle: '🤖 起動するサブエージェント',
			loopTitle: '🔄 差し戻し設定',
			outputFormatTitle: '📐 出力形式',
			requestTitle: '📤 サブエージェントへの依頼形式',
			stepsTitle: '🔁 オーケストレーション手順',
			outputTitle: '🧾 最終出力',
			endConditionsTitle: '✅ 終了条件',
			agentListNote: '各列が `-` の場合、その項目はエージェント定義または関連スキルに従います。',
			agentTableHeaders: ['No', 'サブエージェント', '目的', '入力', '期待する出力', '担当完了条件'],
			loopTableHeaders: ['作業No', '作業エージェント', '確認No', '確認エージェント', '最大試行回数', 'レビュー通過条件'],
			requestTableHeaders: ['項目', '内容'],
			endTableHeaders: ['条件', '終了時の対応'],
			requestRows: [
				['目的', 'サブエージェントに依頼する内容'],
				['入力', '判断または作業に必要な情報'],
				['期待する出力', 'オーケストレーターが次の判断に使う結果'],
				['担当完了条件', 'そのサブエージェントの作業を完了とみなす条件'],
			],
			defaultReportBullets: [
				'最終結果',
				'途中で行った主な委譲',
				'差し戻しが発生した場合の内容と解消状況',
				'未解決事項または残課題',
			],
			noLoopRow: ['-', '-', '-', '-', '-', '-'],
			noAgentRow: ['-', '-', '-', '-', '-', '-'],
			outputFallback: '最終結果の報告では、少なくとも以下を含めること。',
			endSuccessLabel: '最後に必要な確認または担当作業が完了した',
			endSuccessAction: 'ユーザーへ最終結果を報告して終了する',
			endLoopLabel: '差し戻しが最大試行回数に達した',
			endLoopAction: '未達理由と現時点の成果物をまとめて報告し終了する',
			stepLines: [
				'サブエージェント一覧の `No` 昇順に従ってサブエージェントを起動し、表に定義された `目的`、`入力`、`期待する出力`、`担当完了条件` を渡して委譲する。`-` の項目は、そのサブエージェント固有の定義や関連スキルに委ねる。',
				'現在のサブエージェントに対応する差し戻し設定がない場合は、完了後に未実行の次の `No` へ進む。',
				'現在のサブエージェントに対応する差し戻し設定がある場合は、差し戻し設定表の `確認 No` に示されたサブエージェントを起動する。',
				'`確認 No` のサブエージェント結果が、差し戻し設定表の `レビュー通過条件` を満たさない場合は、対応する `作業 No` のサブエージェントへ差し戻す。',
				'差し戻しは、対応する差し戻し設定の `最大試行回数` に達するまで繰り返す。',
				'`確認 No` のサブエージェント結果が、差し戻し設定表の `レビュー通過条件` を満たした場合は、その確認サブエージェントより後ろにある未実行の次の `No` へ進む。',
				'最後に必要な確認または担当作業が完了したら、タスクを完了しユーザーへ報告する。',
			],
			fallbackName: 'New orchestration',
			workflowNameRequired: 'Workflow の名前は必須です。',
			duplicateNodeId: (nodeId: string) => `重複した nodeId です: ${nodeId}`,
			duplicateEdgeId: (edgeId: string) => `重複した edgeId です: ${edgeId}`,
			danglingEdge: '接続元または接続先が存在しないコネクタがあります。',
			workflowNodeMissing: 'Workflow カードが存在しません。',
			workflowNodeMultiple: 'Workflow カードは 1 つだけ配置してください。',
			agentMissing: 'Agent カードを 1 つ以上配置してください。',
			agentNameMissing: 'Agent カードの使用エージェントが未設定です。',
			agentOrderInvalid: 'Agent カードの No は 1 以上の整数で指定してください。',
			agentOrderDuplicate: 'Agent カードの No が重複しています。',
			loopAttemptsInvalid: 'Loop カードの最大試行回数は 1 以上の整数で指定してください。',
			loopCriteriaMissing: 'Loop カードの受け入れ基準が未設定です。',
			workflowIncomingForbidden: 'Workflow カードは入力ポートを持てません。',
			workflowToAgentOnly: 'Workflow カードは Agent カードにのみ接続できます。',
			agentConnectionInvalid: 'Agent カードは Loop カードにのみ接続できます。',
			loopConnectionInvalid: 'Loop カードは Agent カードにのみ接続できます。',
			loopIncomingRequired: 'Loop カードには作業 Agent からの入力接続が 1 つ必要です。',
			loopOutgoingRequired: 'Loop カードには確認 Agent への出力接続が 1 つ必要です。',
			loopOrderInvalid: 'Loop の作業 Agent は確認 Agent より小さい No である必要があります。',
			unreachableNode: 'Workflow カードから到達できないカードがあります。',
			cycleDetected: '循環参照があるためプロンプト生成できません。',
		};
	}

	return {
		mainRoleTitle: 'Goal',
		mainRoleBody: [
			'You are acting as the orchestrator. Your job is limited to delegating from the main agent to subagents, receiving results, deciding whether work must be sent back, and deciding when the task is complete.',
			'',
			'The detailed work executed by each subagent should be delegated to that subagent definition or its related skills.',
		],
		policyTitle: 'Operating policy',
		policyBody: [
			'The main agent must behave only as an orchestrator.',
			'The main agent must not perform the work itself and must always delegate the work to subagents.',
			'The main agent is responsible only for organizing the user request, delegating, receiving results, deciding whether to send work back, giving interim updates, and summarizing the final result.',
			'Each subagent request must be limited to purpose, input, expected output, and assigned done criteria.',
			'Leave subagent-specific procedures to the subagent definition or related skills.',
			'Use the ascending `No` order in the subagent table as the default launch order.',
			'Only when the current subagent has a review and retry setting should the mapped subagent in `Reviewer No` be launched with priority.',
			'Even when there is no special output format, complete the task and report to the user once the last required review or assigned task is complete.',
		],
		agentListTitle: 'Subagents to launch',
		loopTitle: 'Review and retry settings',
		outputFormatTitle: 'Output format',
		requestTitle: 'Delegation format for subagents',
		stepsTitle: 'Orchestration steps',
		outputTitle: 'Final output',
		endConditionsTitle: 'Exit conditions',
		agentListNote: 'When a column is `-`, follow the subagent definition or related skills for that field.',
		agentTableHeaders: ['No', 'Subagent', 'Purpose', 'Input', 'Expected output', 'Assigned done criteria'],
		loopTableHeaders: ['Worker No', 'Worker agent', 'Reviewer No', 'Reviewer agent', 'Max attempts', 'Review pass criteria'],
		requestTableHeaders: ['Field', 'Meaning'],
		endTableHeaders: ['Condition', 'Action'],
		requestRows: [
			['Purpose', 'What the subagent is being asked to do'],
			['Input', 'Information needed for judgment or execution'],
			['Expected output', 'The result the orchestrator will use for the next decision'],
			['Assigned done criteria', 'What must be true for the subagent task to count as complete'],
		],
		defaultReportBullets: [
			'Final result',
			'Major delegations performed',
			'If retries happened, what was sent back and how it was resolved',
			'Open issues or remaining work',
		],
		noLoopRow: ['-', '-', '-', '-', '-', '-'],
		noAgentRow: ['-', '-', '-', '-', '-', '-'],
		outputFallback: 'Include at least the following items in the final report.',
		endSuccessLabel: 'The last required review or assigned task is complete',
		endSuccessAction: 'Report the final result to the user and finish',
		endLoopLabel: 'A retry reaches the maximum number of attempts',
		endLoopAction: 'Report the reason for the incomplete result together with the current artifacts and finish',
		stepLines: [
			'Launch subagents in ascending `No` order and delegate using the `Purpose`, `Input`, `Expected output`, and `Assigned done criteria` defined in the table. Fields shown as `-` should follow the subagent-specific definition or related skills.',
			'If the current subagent has no review and retry setting, continue with the next unlaunched `No` after completion.',
			'If the current subagent has a review and retry setting, launch the subagent indicated by `Reviewer No` in that setting.',
			'If the `Reviewer No` subagent result does not satisfy the `Review pass criteria` in the review and retry table, send the work back to the corresponding `Worker No` subagent.',
			'Repeat the retry until the `Max attempts` value in that setting is reached.',
			'If the `Reviewer No` subagent result satisfies the `Review pass criteria` in the review and retry table, continue with the next unlaunched `No` after that reviewer subagent.',
			'When the last required review or assigned task is complete, finish the task and report back to the user.',
		],
		fallbackName: 'New orchestration',
		workflowNameRequired: 'The workflow name is required.',
		duplicateNodeId: (nodeId: string) => `Duplicate nodeId: ${nodeId}`,
		duplicateEdgeId: (edgeId: string) => `Duplicate edgeId: ${edgeId}`,
		danglingEdge: 'A connector references a source or target that does not exist.',
		workflowNodeMissing: 'A Workflow card is required.',
		workflowNodeMultiple: 'Only one Workflow card can exist.',
		agentMissing: 'At least one Agent card is required.',
		agentNameMissing: 'Each Agent card must select a subagent.',
		agentOrderInvalid: 'Each Agent card No must be an integer greater than or equal to 1.',
		agentOrderDuplicate: 'Agent card No values must be unique.',
		loopAttemptsInvalid: 'Loop max attempts must be an integer greater than or equal to 1.',
		loopCriteriaMissing: 'The Loop acceptance criteria are empty.',
		workflowIncomingForbidden: 'A Workflow card cannot have incoming connectors.',
		workflowToAgentOnly: 'A Workflow card can connect only to Agent cards.',
		agentConnectionInvalid: 'An Agent card can connect only to a Loop card.',
		loopConnectionInvalid: 'A Loop card can connect only to an Agent card.',
		loopIncomingRequired: 'A Loop card needs exactly one incoming connection from a worker Agent.',
		loopOutgoingRequired: 'A Loop card needs exactly one outgoing connection to a reviewer Agent.',
		loopOrderInvalid: 'The worker Agent connected to a Loop must have a smaller No than the reviewer Agent.',
		unreachableNode: 'There is a card that cannot be reached from the Workflow card.',
		cycleDetected: 'Prompt generation is blocked because the graph contains a cycle.',
	};
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
		finalOutputFormat: workflow.finalOutputFormat ?? '',
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
	const migrated = migrateLegacyOutputNodes(record.nodes, record.edges);
	return {
		version:
			typeof record.version === 'number'
				? record.version
				: ORCHESTRATION_SCHEMA_VERSION,
		workflowId: record.workflowId,
		name: record.name,
		description:
			typeof record.description === 'string' ? record.description : '',
		finalOutputFormat:
			typeof record.finalOutputFormat === 'string'
				? record.finalOutputFormat
				: migrated.finalOutputFormat,
		nodes: migrated.nodes,
		edges: migrated.edges,
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
	if (common.cardType === 'workflow') {
		return {
			...common,
			cardType: 'workflow',
		};
	}
	if (common.cardType === 'agent') {
		return {
			...common,
			cardType: 'agent',
			order: typeof record.order === 'number' ? record.order : 0,
			agentName: stringOrDefault(record.agentName, ''),
			purpose: stringOrDefault(record.purpose, ''),
			input: stringOrDefault(record.input, ''),
			expectedOutput: stringOrDefault(record.expectedOutput, ''),
			doneCriteria: stringOrDefault(record.doneCriteria, ''),
		};
	}
	if (common.cardType === 'loop') {
		return {
			...common,
			cardType: 'loop',
			maxAttempts:
				typeof record.maxAttempts === 'number' ? record.maxAttempts : 0,
			acceptanceCriteria: stringOrDefault(record.acceptanceCriteria, ''),
		};
	}
	throw new Error(`Unsupported cardType: ${String(record.cardType)}`);
}

function migrateLegacyOutputNodes(
	rawNodes: unknown[],
	rawEdges: unknown[],
): {
	nodes: OrchestrationNode[];
	edges: OrchestrationEdge[];
	finalOutputFormat: string;
} {
	const legacyOutputIds = new Set<string>();
	const legacyOutputDetails: string[] = [];
	const nodes = rawNodes.flatMap((value) => {
		if (!value || typeof value !== 'object') {
			return [assertNodeDefinition(value)];
		}
		const record = value as Record<string, unknown>;
		if (record.cardType !== 'output') {
			return [assertNodeDefinition(value)];
		}
		const nodeId = requireString(record.nodeId, 'nodeId');
		legacyOutputIds.add(nodeId);
		const parts = [
			stringOrDefault(record.outputFormat, '').trim(),
			stringOrDefault(record.notes, '').trim(),
			stringOrDefault(record.outputName, '').trim(),
		].filter(Boolean);
		if (parts.length > 0) {
			legacyOutputDetails.push(parts.join(' / '));
		}
		return [];
	});
	const edges = rawEdges
		.map(assertEdgeDefinition)
		.filter(
			(edge) =>
				!legacyOutputIds.has(edge.sourceNodeId)
				&& !legacyOutputIds.has(edge.targetNodeId),
		);
	return {
		nodes,
		edges,
		finalOutputFormat: legacyOutputDetails.join('\n'),
	};
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
