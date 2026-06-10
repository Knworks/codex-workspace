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
	workflow.constraints = 'Stay within the approved scope.';
	workflow.finalOutputFormat = 'Markdown summary / Include risks and remaining work.';
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
			assert.strictEqual(reloaded.constraints, 'Stay within the approved scope.');
			assert.strictEqual(
				reloaded.finalOutputFormat,
				'Markdown summary / Include risks and remaining work.',
			);
			assert.strictEqual(reloaded.updatedAt, '2026-06-06T12:30:00.000Z');
			assert.strictEqual(summaries.length, 1);
			assert.strictEqual(summaries[0].workflowId, saved.workflowId);
		});
	});

	test('loads legacy output nodes into workflow final output format', () => {
		withTempDir((root) => {
			const codexDir = path.join(root, '.codex');
			const orchestrationDir = path.join(
				codexDir,
				'.codex-workspace',
				'orchestrations',
			);
			fs.mkdirSync(orchestrationDir, { recursive: true });
			fs.writeFileSync(
				path.join(orchestrationDir, 'legacy.json'),
				JSON.stringify({
					version: 2,
					workflowId: 'legacy',
					name: 'Legacy workflow',
					description: 'Legacy output migration test.',
					nodes: [
						{ nodeId: 'workflow-node', cardType: 'workflow', x: 80, y: 120 },
						{
							nodeId: 'agent-1',
							cardType: 'agent',
							order: 1,
							agentName: 'implementer',
							purpose: '',
							input: '',
							expectedOutput: '',
							doneCriteria: '',
							x: 320,
							y: 120,
						},
						{
							nodeId: 'output-1',
							cardType: 'output',
							outputName: 'Final report',
							outputFormat: 'Markdown summary',
							notes: 'Include risks and remaining work.',
							x: 540,
							y: 120,
						},
					],
					edges: [
						{
							edgeId: 'edge-workflow-agent',
							sourceNodeId: 'workflow-node',
							targetNodeId: 'agent-1',
						},
						{
							edgeId: 'edge-agent-output',
							sourceNodeId: 'agent-1',
							targetNodeId: 'output-1',
						},
					],
					createdAt: '2026-06-06T12:00:00.000Z',
					updatedAt: '2026-06-06T12:00:00.000Z',
				}),
				'utf8',
			);

			const loaded = loadWorkflowDefinition('legacy', codexDir);

			assert.strictEqual(
				loaded.finalOutputFormat,
				'Markdown summary / Include risks and remaining work. / Final report',
			);
			assert.ok(loaded.nodes.every((node) => node.nodeId !== 'output-1'));
			assert.ok(loaded.edges.every((edge) => edge.targetNodeId !== 'output-1'));
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

	test('validation localizes issue messages for English', () => {
		const workflow = createWorkflowFixture();
		workflow.name = '';
		const worker = workflow.nodes.find(
			(node): node is Extract<OrchestrationWorkflow['nodes'][number], { cardType: 'agent' }> =>
				node.cardType === 'agent' && node.nodeId === 'agent-worker',
		);
		assert.ok(worker);
		if (!worker) {
			return;
		}
		worker.agentName = '';

		const validation = validateWorkflowDefinition(workflow, 'en');

		assert.ok(validation.errors.some((issue) => issue.message === 'The orchestration name is required.'));
		assert.ok(validation.errors.some((issue) => issue.message === 'Each Agent card must select a subagent.'));
	});

	test('generateWorkflowPrompt renders localized Japanese prompt', () => {
		const workflow = createWorkflowFixture();

		const result = generateWorkflowPrompt(workflow, 'ja');

		assert.strictEqual(result.validation.errors.length, 0);
		assert.ok(result.prompt.includes('name: "Review loop"'));
		assert.ok(result.prompt.includes('## 🎯 目的'));
		assert.ok(result.prompt.includes('implementer'));
		assert.ok(result.prompt.includes('reviewer'));
		assert.ok(result.prompt.includes('各列が `-` の場合、その項目はエージェント定義または関連スキルに従います。'));
		assert.ok(result.prompt.includes('## 制約'));
		assert.ok(result.prompt.includes('Stay within the approved scope.'));
		assert.ok(result.prompt.includes('## 📐 出力形式'));
		assert.ok(result.prompt.includes('Markdown summary / Include risks and remaining work.'));
		assert.ok(!result.prompt.includes('- Markdown summary / Include risks and remaining work.'));
		assert.ok(result.prompt.includes('## 🧾 最終出力'));
		assert.ok(result.prompt.includes('差し戻し設定'));
		assert.ok(result.prompt.includes('| No | サブエージェント | 目的 | 入力 | 期待する出力 | 担当完了条件 |'));
		assert.ok(result.prompt.includes('| 作業No | 作業エージェント | 確認No | 確認エージェント | 最大試行回数 | レビュー通過条件 |'));
		assert.ok(result.prompt.includes('| 担当完了条件 | そのサブエージェントの作業を完了とみなす条件 |'));
		assert.ok(result.prompt.includes('| 1 | implementer | 2 | reviewer | 5 | The review result is PASS. |'));
		assert.ok(result.prompt.includes('サブエージェントへの依頼は、目的、入力、期待する出力、担当完了条件に絞る。'));
		assert.ok(result.prompt.includes('現在のサブエージェントに対応する差し戻し設定がある場合のみ'));
		assert.ok(result.prompt.includes('差し戻し設定がない場合は、完了後に未実行の次の `No` へ進む。'));
		assert.ok(result.prompt.includes('差し戻し設定表の `レビュー通過条件` を満たさない場合'));
		assert.ok(result.prompt.includes('最後に必要な確認または担当作業が完了したら'));
		assert.ok(result.prompt.includes('| 最後に必要な確認または担当作業が完了した | ユーザーへ最終結果を報告して終了する |'));
		assert.ok(result.prompt.includes('最終結果の報告では、少なくとも以下を含めること。\n\n- 最終結果'));
		assert.ok(result.prompt.includes('The review result is PASS.'));
		assert.ok(result.prompt.indexOf('## 制約') > result.prompt.indexOf('## 🧑‍✈️ 基本方針'));
		assert.ok(result.prompt.indexOf('## 制約') < result.prompt.indexOf('## 🤖 起動するサブエージェント'));
	});

	test('generateWorkflowPrompt renders localized English prompt', () => {
		const workflow = createWorkflowFixture();

		const result = generateWorkflowPrompt(workflow, 'en');

		assert.strictEqual(result.validation.errors.length, 0);
		assert.ok(result.prompt.includes('## Goal'));
		assert.ok(result.prompt.includes('## Constraints'));
		assert.ok(result.prompt.includes('Stay within the approved scope.'));
		assert.ok(result.prompt.includes('## Review and retry settings'));
		assert.ok(result.prompt.includes('When a column is `-`, follow the subagent definition or related skills for that field.'));
		assert.ok(result.prompt.includes('## Output format'));
		assert.ok(result.prompt.includes('## Final output'));
		assert.ok(result.prompt.includes('Launch subagents in ascending `No` order'));
		assert.ok(result.prompt.includes('| No | Subagent | Purpose | Input | Expected output | Assigned done criteria |'));
		assert.ok(result.prompt.includes('| Worker No | Worker agent | Reviewer No | Reviewer agent | Max attempts | Review pass criteria |'));
		assert.ok(result.prompt.includes('| Assigned done criteria | What must be true for the subagent task to count as complete |'));
		assert.ok(result.prompt.includes('| 1 | implementer | 2 | reviewer | 5 | The review result is PASS. |'));
		assert.ok(result.prompt.includes('Each subagent request must be limited to purpose, input, expected output, and assigned done criteria.'));
		assert.ok(result.prompt.includes('Only when the current subagent has a review and retry setting'));
		assert.ok(result.prompt.includes('If the current subagent has no review and retry setting'));
		assert.ok(result.prompt.includes('does not satisfy the `Review pass criteria` in the review and retry table'));
		assert.ok(result.prompt.includes('When the last required review or assigned task is complete'));
		assert.ok(result.prompt.includes('| The last required review or assigned task is complete | Report the final result to the user and finish |'));
		assert.ok(result.prompt.includes('Include at least the following items in the final report.\n\n- Final result'));
		assert.ok(result.prompt.includes('Markdown summary'));
		assert.ok(result.prompt.indexOf('## Constraints') > result.prompt.indexOf('## Operating policy'));
		assert.ok(result.prompt.indexOf('## Constraints') < result.prompt.indexOf('## Subagents to launch'));
	});

	test('generateWorkflowPrompt keeps blank delegation fields compact and explains fallback once', () => {
		const workflow = createWorkflowFixture();
		const worker = workflow.nodes.find(
			(node): node is Extract<OrchestrationWorkflow['nodes'][number], { cardType: 'agent' }> =>
				node.cardType === 'agent' && node.nodeId === 'agent-worker',
		);
		assert.ok(worker);
		if (!worker) {
			return;
		}
		worker.purpose = '';
		worker.input = '';
		worker.expectedOutput = '';
		worker.doneCriteria = '';

		const result = generateWorkflowPrompt(workflow, 'ja');

		assert.strictEqual(result.validation.errors.length, 0);
		assert.ok(result.prompt.includes('各列が `-` の場合、その項目はエージェント定義または関連スキルに従います。'));
		assert.ok(result.prompt.includes('| 1 | implementer | - | - | - | - |'));
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
			const orchestrationDir = path.join(
				codexDir,
				'.codex-workspace',
				'orchestrations',
			);
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
