import * as assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
	createWorkflowFromTemplate,
	generateWorkflowPrompt,
	listSavedWorkflowSummaries,
	loadWorkflowDefinition,
	saveWorkflowDefinition,
	validateWorkflowDefinition,
	type OrchestrationWorkflow,
} from '../services/orchestrationService';

function withTempDir(run: (root: string) => void): void {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orchestration-service-'));
	try {
		run(tempDir);
	} finally {
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
}

suite('Orchestration service', () => {
	test('saves and loads workflow definitions', () => {
		withTempDir((root) => {
			const codexDir = path.join(root, '.codex');
			fs.mkdirSync(codexDir, { recursive: true });
			const workflow = createWorkflowFromTemplate(
				'research-plan',
				['researcher', 'planner'],
				'2026-05-24T12:00:00.000Z',
			);

			const saved = saveWorkflowDefinition(
				workflow,
				codexDir,
				'2026-05-24T12:30:00.000Z',
			);
			const reloaded = loadWorkflowDefinition(saved.workflowId, codexDir);
			const summaries = listSavedWorkflowSummaries(codexDir);

			assert.strictEqual(reloaded.workflowId, saved.workflowId);
			assert.strictEqual(reloaded.name, saved.name);
			assert.strictEqual(reloaded.updatedAt, '2026-05-24T12:30:00.000Z');
			assert.strictEqual(summaries.length, 1);
			assert.strictEqual(summaries[0].workflowId, saved.workflowId);
		});
	});

	test('validation detects missing fields and cycles', () => {
		const workflow = createWorkflowFromTemplate(
			'research-plan',
			['researcher', 'planner'],
			'2026-05-24T12:00:00.000Z',
		);
		const agentTask = workflow.nodes.find((node) => node.cardType === 'agentTask');
		assert.ok(agentTask && agentTask.cardType === 'agentTask');
		if (agentTask?.cardType !== 'agentTask') {
			return;
		}
		agentTask.agentName = '';
		agentTask.instruction = '';
		agentTask.outputContract = '';
		const outputNode = workflow.nodes.find((node) => node.cardType === 'output');
		assert.ok(outputNode);
		if (!outputNode) {
			return;
		}
		workflow.edges.push({
			edgeId: 'cycle-edge',
			sourceNodeId: outputNode.nodeId,
			targetNodeId: workflow.nodes[0].nodeId,
		});

		const validation = validateWorkflowDefinition(workflow);

		assert.ok(validation.errors.some((issue) => issue.code === 'emptyAgent'));
		assert.ok(validation.errors.some((issue) => issue.code === 'emptyInstruction'));
		assert.ok(validation.errors.some((issue) => issue.code === 'emptyOutputContract'));
		assert.ok(validation.errors.some((issue) => issue.code === 'cycle'));
	});

	test('generateWorkflowPrompt describes parallel execution and outputs', () => {
		const workflow = createWorkflowFromTemplate(
			'parallel-review',
			['pr_explorer', 'reviewer'],
			'2026-05-24T12:00:00.000Z',
		);

		const result = generateWorkflowPrompt(workflow);

		assert.strictEqual(result.validation.errors.length, 0);
		assert.ok(result.prompt.includes('目的:'));
		assert.ok(result.prompt.includes('pr_explorer'));
		assert.ok(result.prompt.includes('reviewer'));
		assert.ok(result.prompt.includes('並列に起動してください'));
		assert.ok(result.prompt.includes('最終結果、主要なリスク、次のアクション'));
	});

	test('generateWorkflowPrompt refuses invalid workflows', () => {
		const workflow = createWorkflowFromTemplate(
			'design-test',
			['designer', 'tester'],
			'2026-05-24T12:00:00.000Z',
		);
		const startNode = workflow.nodes.find(
			(node): node is Extract<OrchestrationWorkflow['nodes'][number], { cardType: 'start' }> =>
				node.cardType === 'start',
		);
		assert.ok(startNode);
		if (!startNode) {
			return;
		}
		startNode.goal = '';
		workflow.nodes = workflow.nodes.filter((node) => node.cardType !== 'output');

		const result = generateWorkflowPrompt(workflow);

		assert.strictEqual(result.prompt, '');
		assert.ok(result.validation.errors.some((issue) => issue.code === 'missingOutput'));
	});

	test('loadWorkflowDefinition rejects invalid JSON files', () => {
		withTempDir((root) => {
			const codexDir = path.join(root, '.codex');
			const orchestrationDir = path.join(codexDir, 'orchestrations');
			fs.mkdirSync(orchestrationDir, { recursive: true });
			fs.writeFileSync(
				path.join(orchestrationDir, 'broken.json'),
				'{ invalid json',
				'utf8',
			);

			assert.throws(
				() => loadWorkflowDefinition('broken', codexDir),
				/Invalid orchestration JSON/,
			);
		});
	});

	test('generateWorkflowPrompt allows warnings without blocking output', () => {
		const workflow = createWorkflowFromTemplate(
			'design-test',
			['designer', 'tester'],
			'2026-05-24T12:00:00.000Z',
		);
		const startNode = workflow.nodes.find(
			(node): node is Extract<OrchestrationWorkflow['nodes'][number], { cardType: 'start' }> =>
				node.cardType === 'start',
		);
		assert.ok(startNode);
		if (!startNode) {
			return;
		}
		startNode.goal = '';

		const result = generateWorkflowPrompt(workflow);

		assert.strictEqual(result.validation.errors.length, 0);
		assert.ok(result.validation.warnings.some((issue) => issue.code === 'emptyGoal'));
		assert.ok(result.prompt.includes('目的:'));
		assert.ok(result.prompt.includes('目的未設定'));
	});
});
