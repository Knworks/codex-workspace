import * as assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
	createEmptyWorkflow,
	deleteWorkflowDefinition,
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

function createWorkflowFixture(): OrchestrationWorkflow {
	const workflow = createEmptyWorkflow('Review loop');
	workflow.description = 'Implement and review the task.';
	const workflowNode = workflow.nodes.find((node) => node.cardType === 'workflow');
	assert.ok(workflowNode);
	if (!workflowNode) {
		return workflow;
	}

	workflow.nodes.push(
		{
			nodeId: 'agent-worker',
			cardType: 'agent',
			order: 1,
			agentName: 'implementer',
			purpose: 'Implement the requested change.',
			input: 'User request and current code.',
			expectedOutput: 'Changed files and implementation summary.',
			doneCriteria: 'The change is implemented and ready for review.',
			x: 320,
			y: 120,
		},
		{
			nodeId: 'loop-review',
			cardType: 'loop',
			maxAttempts: 5,
			acceptanceCriteria: 'The review result is PASS.',
			x: 540,
			y: 120,
		},
		{
			nodeId: 'agent-reviewer',
			cardType: 'agent',
			order: 2,
			agentName: 'reviewer',
			purpose: 'Review the implementation and decide whether it should be sent back.',
			input: 'Implementation result from the worker.',
			expectedOutput: 'PASS/FAIL with review comments.',
			doneCriteria: 'A clear PASS/FAIL decision is returned.',
			x: 760,
			y: 120,
		},
		{
			nodeId: 'output-final',
			cardType: 'output',
			outputName: 'Final report',
			outputFormat: 'Markdown summary',
			notes: 'Include risks and remaining work.',
			x: 980,
			y: 120,
		},
	);
	workflow.edges.push(
		{
			edgeId: 'edge-workflow-worker',
			sourceNodeId: workflowNode.nodeId,
			targetNodeId: 'agent-worker',
		},
		{
			edgeId: 'edge-workflow-reviewer',
			sourceNodeId: workflowNode.nodeId,
			targetNodeId: 'agent-reviewer',
		},
		{
			edgeId: 'edge-worker-loop',
			sourceNodeId: 'agent-worker',
			targetNodeId: 'loop-review',
		},
		{
			edgeId: 'edge-loop-reviewer',
			sourceNodeId: 'loop-review',
			targetNodeId: 'agent-reviewer',
		},
		{
			edgeId: 'edge-reviewer-output',
			sourceNodeId: 'agent-reviewer',
			targetNodeId: 'output-final',
		},
	);
	return workflow;
}

suite('Orchestration service', () => {
	test('saves and loads workflow definitions', () => {
		withTempDir((root) => {
			const codexDir = path.join(root, '.codex');
			fs.mkdirSync(codexDir, { recursive: true });
			const workflow = createWorkflowFixture();

			const saved = saveWorkflowDefinition(
				workflow,
				codexDir,
				'2026-06-06T12:30:00.000Z',
			);
			const reloaded = loadWorkflowDefinition(saved.workflowId, codexDir);
			const summaries = listSavedWorkflowSummaries(codexDir);

			assert.strictEqual(reloaded.workflowId, saved.workflowId);
			assert.strictEqual(reloaded.name, saved.name);
			assert.strictEqual(reloaded.updatedAt, '2026-06-06T12:30:00.000Z');
			assert.strictEqual(summaries.length, 1);
			assert.strictEqual(summaries[0].workflowId, saved.workflowId);
		});
	});

	test('deletes saved workflow definitions', () => {
		withTempDir((root) => {
			const codexDir = path.join(root, '.codex');
			fs.mkdirSync(codexDir, { recursive: true });
			const workflow = createWorkflowFixture();

			const saved = saveWorkflowDefinition(
				workflow,
				codexDir,
				'2026-06-06T12:30:00.000Z',
			);
			deleteWorkflowDefinition(saved.workflowId, codexDir);

			assert.deepStrictEqual(listSavedWorkflowSummaries(codexDir), []);
			assert.throws(
				() => loadWorkflowDefinition(saved.workflowId, codexDir),
				/ENOENT/,
			);
		});
	});

	test('validation detects missing agent fields and invalid loop order', () => {
		const workflow = createWorkflowFixture();
		const worker = workflow.nodes.find(
			(node): node is Extract<OrchestrationWorkflow['nodes'][number], { cardType: 'agent' }> =>
				node.cardType === 'agent' && node.nodeId === 'agent-worker',
		);
		assert.ok(worker);
		if (!worker) {
			return;
		}
		worker.agentName = '';
		worker.order = 2;
		const reviewer = workflow.nodes.find(
			(node): node is Extract<OrchestrationWorkflow['nodes'][number], { cardType: 'agent' }> =>
				node.cardType === 'agent' && node.nodeId === 'agent-reviewer',
		);
		assert.ok(reviewer);
		if (!reviewer) {
			return;
		}
		reviewer.order = 2;

		const validation = validateWorkflowDefinition(workflow);

		assert.ok(validation.errors.some((issue) => issue.code === 'emptyAgent'));
		assert.ok(validation.errors.some((issue) => issue.code === 'duplicateAgentOrder'));
		assert.ok(validation.errors.some((issue) => issue.code === 'invalidLoopOrder'));
	});

	test('generateWorkflowPrompt renders localized Japanese prompt', () => {
		const workflow = createWorkflowFixture();

		const result = generateWorkflowPrompt(workflow, 'ja');

		assert.strictEqual(result.validation.errors.length, 0);
		assert.ok(result.prompt.includes('name: "Review loop"'));
		assert.ok(result.prompt.includes('## 🎯 目的'));
		assert.ok(result.prompt.includes('implementer'));
		assert.ok(result.prompt.includes('reviewer'));
		assert.ok(result.prompt.includes('差し戻し設定'));
		assert.ok(result.prompt.includes('The review result is PASS.'));
	});

	test('generateWorkflowPrompt renders localized English prompt', () => {
		const workflow = createWorkflowFixture();

		const result = generateWorkflowPrompt(workflow, 'en');

		assert.strictEqual(result.validation.errors.length, 0);
		assert.ok(result.prompt.includes('## Goal'));
		assert.ok(result.prompt.includes('## Review and retry settings'));
		assert.ok(result.prompt.includes('Launch subagents in ascending `No` order'));
		assert.ok(result.prompt.includes('Markdown summary'));
	});

	test('generateWorkflowPrompt refuses invalid workflows', () => {
		const workflow = createWorkflowFixture();
		workflow.name = '';

		const result = generateWorkflowPrompt(workflow, 'ja');

		assert.strictEqual(result.prompt, '');
		assert.ok(result.validation.errors.some((issue) => issue.code === 'emptyWorkflowName'));
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
		const workflow = createWorkflowFixture();
		const loop = workflow.nodes.find(
			(node): node is Extract<OrchestrationWorkflow['nodes'][number], { cardType: 'loop' }> =>
				node.cardType === 'loop',
		);
		assert.ok(loop);
		if (!loop) {
			return;
		}
		loop.acceptanceCriteria = '';

		const result = generateWorkflowPrompt(workflow, 'ja');

		assert.strictEqual(result.validation.errors.length, 0);
		assert.ok(result.validation.warnings.some((issue) => issue.code === 'emptyAcceptanceCriteria'));
		assert.ok(result.prompt.includes('差し戻し設定'));
	});
});
