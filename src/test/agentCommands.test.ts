import * as assert from 'assert';
import fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import * as toml from 'toml';
import { listCliAgentRecords } from '../services/cliAgentService';
import { CodexTreeItem } from '../models/treeItems';
import { listAgentManagerRecords } from '../services/agentManagerService';

type EnvSnapshot = {
	HOME?: string;
	USERPROFILE?: string;
	HOMEDRIVE?: string;
	HOMEPATH?: string;
};

async function withTempHome(
	run: (homeDir: string) => Promise<void>,
): Promise<void> {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-agent-'));
	const originalEnv: EnvSnapshot = {
		HOME: process.env.HOME,
		USERPROFILE: process.env.USERPROFILE,
		HOMEDRIVE: process.env.HOMEDRIVE,
		HOMEPATH: process.env.HOMEPATH,
	};
	process.env.HOME = tempDir;
	process.env.USERPROFILE = tempDir;
	process.env.HOMEDRIVE = '';
	process.env.HOMEPATH = tempDir;

	try {
		await run(tempDir);
	} finally {
		process.env.HOME = originalEnv.HOME;
		process.env.USERPROFILE = originalEnv.USERPROFILE;
		process.env.HOMEDRIVE = originalEnv.HOMEDRIVE;
		process.env.HOMEPATH = originalEnv.HOMEPATH;
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
}

function createWorkspace(homeDir: string): { codexDir: string; agentsDir: string; configPath: string } {
	const codexDir = path.join(homeDir, '.codex');
	const agentsDir = path.join(codexDir, 'agents');
	const configPath = path.join(codexDir, 'config.toml');
	fs.mkdirSync(agentsDir, { recursive: true });
	fs.writeFileSync(configPath, 'title = "ok"\n', 'utf8');
	return { codexDir, agentsDir, configPath };
}

async function activateExtension(): Promise<void> {
	const extension = vscode.extensions.getExtension('Knworks.codex-workspace');
	assert.ok(extension, 'extension not found');
	await extension.activate();
}

function createAgentItem(agentFilePath: string): CodexTreeItem {
	return new CodexTreeItem(
		'file',
		'agents',
		path.basename(agentFilePath),
		vscode.TreeItemCollapsibleState.None,
		agentFilePath,
	);
}

type AcceptHandler = () => void;
type ChangeValueHandler = (value: string) => void;
type HideHandler = () => void;

class FakeQuickPick {
	value = '';
	title = '';
	placeholder: string | undefined;
	ignoreFocusOut = false;
	items: Array<vscode.QuickPickItem & { value: string }> = [];
	activeItems: Array<vscode.QuickPickItem & { value: string }> = [];
	selectedItems: Array<vscode.QuickPickItem & { value: string }> = [];
	matchOnDescription = false;
	matchOnDetail = false;
	sortByLabel = true;
	canSelectMany = false;
	busy = false;
	enabled = true;
	keepScrollPosition = false;
	step: number | undefined;
	totalSteps: number | undefined;
	valueSelection: [number, number] | undefined;
	buttons: readonly vscode.QuickInputButton[] = [];
	description: string | undefined;
	detail: string | undefined;

	private readonly acceptHandlers: AcceptHandler[] = [];
	private readonly changeHandlers: ChangeValueHandler[] = [];
	private readonly hideHandlers: HideHandler[] = [];
	private showHook: (() => void) | undefined;

	show(): void {
		this.showHook?.();
	}

	hide(): void {
		for (const handler of this.hideHandlers) {
			handler();
		}
	}

	dispose(): void {
		// no-op
	}

	onDidAccept(handler: AcceptHandler): vscode.Disposable {
		this.acceptHandlers.push(handler);
		return new vscode.Disposable(() => undefined);
	}

	onDidChangeValue(handler: ChangeValueHandler): vscode.Disposable {
		this.changeHandlers.push(handler);
		return new vscode.Disposable(() => undefined);
	}

	onDidHide(handler: HideHandler): vscode.Disposable {
		this.hideHandlers.push(handler);
		return new vscode.Disposable(() => undefined);
	}

	onDidTriggerButton(): vscode.Disposable {
		return new vscode.Disposable(() => undefined);
	}

	onDidTriggerItemButton(): vscode.Disposable {
		return new vscode.Disposable(() => undefined);
	}

	onDidChangeActive(): vscode.Disposable {
		return new vscode.Disposable(() => undefined);
	}

	onDidChangeSelection(): vscode.Disposable {
		return new vscode.Disposable(() => undefined);
	}

	setShowHook(handler: () => void): void {
		this.showHook = handler;
	}

	triggerValueChange(value: string): void {
		this.value = value;
		for (const handler of this.changeHandlers) {
			handler(value);
		}
	}

	triggerAccept(): void {
		for (const handler of this.acceptHandlers) {
			handler();
		}
	}
}

function mockQuickPickTextInputs(
	values: string[],
	sequence?: string[],
): () => void {
	const originalCreateQuickPick = vscode.window.createQuickPick;
	(vscode.window as unknown as { createQuickPick: typeof originalCreateQuickPick }).createQuickPick =
		() => {
			const fakeQuickPick = new FakeQuickPick();
			fakeQuickPick.setShowHook(() => {
				const value = values.shift();
				sequence?.push('name');
				if (value === undefined) {
					fakeQuickPick.hide();
					return;
				}
				fakeQuickPick.triggerValueChange(value);
				fakeQuickPick.triggerAccept();
			});
			return fakeQuickPick as unknown as vscode.QuickPick<any>;
		};
	return () => {
		(vscode.window as unknown as { createQuickPick: typeof originalCreateQuickPick }).createQuickPick =
			originalCreateQuickPick;
	};
}

suite('Agent commands', () => {
	test('Explorer toggles a Profile alias using its declaration identity instead of its file name', async () => {
		await withTempHome(async (homeDir) => {
			const { agentsDir, configPath, codexDir } = createWorkspace(homeDir);
			const target = path.join(agentsDir, 'physical.toml');
			fs.writeFileSync(target, '');
			const declaration = '[agents.role_alias]\nconfig_file = "agents/physical.toml"\n';
			fs.writeFileSync(configPath, declaration);
			const profilePath = path.join(codexDir, 'review.config.toml');
			fs.writeFileSync(profilePath, declaration);
			await activateExtension();
			const item = createAgentItem(target);
			item.agentRecord = listAgentManagerRecords(configPath).find((record) => record.configPath === profilePath);
			assert.ok(item.agentRecord);
			const originalInfo = vscode.window.showInformationMessage;
			let unchangedInfos = 0;
			vscode.window.showInformationMessage = (async () => { unchangedInfos += 1; }) as typeof originalInfo;
			try {
				await vscode.commands.executeCommand('codex-workspace.enableAgent', item);
				assert.strictEqual(unchangedInfos, 0);
				assert.strictEqual(fs.readFileSync(profilePath, 'utf8'), declaration);
			} finally { vscode.window.showInformationMessage = originalInfo; }
			await vscode.commands.executeCommand('codex-workspace.disableAgent', item);
			assert.strictEqual(fs.readFileSync(configPath, 'utf8'), declaration);
			assert.ok(!fs.readFileSync(profilePath, 'utf8').includes('role_alias'));
			await vscode.commands.executeCommand('codex-workspace.enableAgent', item);
			assert.strictEqual(fs.readFileSync(configPath, 'utf8'), declaration);
			assert.ok(fs.readFileSync(profilePath, 'utf8').includes('agents/physical.toml'));
			assert.strictEqual(fs.existsSync(path.join(codexDir, '.codex-workspace', 'review.config.toml.agents-disabled.json')), false);
		});
	});
	test('addAgent executes name -> description -> template and scaffolds without template', async () => {
		await withTempHome(async (homeDir) => {
			const { codexDir, agentsDir, configPath } = createWorkspace(homeDir);
			const templateRoot = path.join(codexDir, 'codex-templates');
			fs.mkdirSync(templateRoot, { recursive: true });
			fs.writeFileSync(
				path.join(templateRoot, 'base.toml'),
				'developer_instructions = """\nReview changes carefully.\n"""\nmode = "base"\n',
				'utf8',
			);
			await activateExtension();

			const sequence: string[] = [];
			const originalInput = vscode.window.showInputBox;
			const originalPick = vscode.window.showQuickPick;
			const restoreQuickPickInput = mockQuickPickTextInputs(['reviewer'], sequence);

			(vscode.window as unknown as { showInputBox: typeof originalInput }).showInputBox =
				async () => {
					sequence.push('description');
					return 'Security reviewer';
				};
			(vscode.window as unknown as { showQuickPick: typeof originalPick }).showQuickPick =
				async (items: any) => {
					if (items.some((item: { label?: string }) => item.label === 'Workspace Agents')) {
						sequence.push('location');
						return items.find((item: { label?: string }) => item.label === 'Workspace Agents');
					}
					sequence.push('template');
					return items[0];
				};

			try {
				await vscode.commands.executeCommand('codex-workspace.addAgent');
			} finally {
				restoreQuickPickInput();
				(vscode.window as unknown as { showInputBox: typeof originalInput }).showInputBox =
					originalInput;
				(vscode.window as unknown as { showQuickPick: typeof originalPick }).showQuickPick =
					originalPick;
			}

			assert.deepStrictEqual(sequence, ['location', 'name', 'description', 'template']);
			const createdPath = path.join(agentsDir, 'reviewer.toml');
			assert.ok(fs.existsSync(createdPath));
			const createdContents = fs.readFileSync(createdPath, 'utf8');
			assert.ok(createdContents.includes('# name: reviewer\n# description: Security reviewer'));
			assert.deepStrictEqual({ ...toml.parse(createdContents) }, {
				name: 'reviewer',
				description: 'Security reviewer',
				developer_instructions: 'Security reviewer',
			});
			const config = fs.readFileSync(configPath, 'utf8');
			assert.ok(config.includes('[agents.reviewer]'));
			assert.ok(config.includes('description = "Security reviewer"'));
			assert.ok(config.includes('config_file = "agents/reviewer.toml"'));
			const cliRecord = listCliAgentRecords(configPath).find((record) => record.agentPath === createdPath);
			assert.ok(cliRecord);
			assert.strictEqual(cliRecord.name, 'reviewer');
			assert.strictEqual(cliRecord.availability, 'available');
			assert.strictEqual(cliRecord.enabled, true);
		});
	});

	for (const scenario of [
		{ label: 'no templates and no description', description: '', template: undefined },
		{ label: 'no templates and whitespace description', description: ' \t ', template: undefined },
		{ label: 'special description', description: '日本語 "引用"\\\nmodel = "injected"\r\n次行\u007f', template: undefined },
		{ label: 'empty selected template', description: 'Keep empty', template: '' },
		{ label: 'cancelled template selection', description: 'Cancelled', template: 'mode = "keep"\n', cancel: true },
	]) {
		test(`addAgent handles ${scenario.label}`, async () => {
			await withTempHome(async (homeDir) => {
				const { codexDir, agentsDir, configPath } = createWorkspace(homeDir);
				if (scenario.template !== undefined) {
					const templateRoot = path.join(codexDir, 'codex-templates');
					fs.mkdirSync(templateRoot, { recursive: true });
					fs.writeFileSync(path.join(templateRoot, 'selected.toml'), scenario.template, 'utf8');
				}
				await activateExtension();
				const originalInput = vscode.window.showInputBox;
				const originalPick = vscode.window.showQuickPick;
				const restoreInput = mockQuickPickTextInputs(['作成_agent']);
				(vscode.window as unknown as { showInputBox: typeof originalInput }).showInputBox =
					async () => scenario.description;
				(vscode.window as unknown as { showQuickPick: typeof originalPick }).showQuickPick =
					async (items: any) => items.find((item: { label?: string }) => item.label === 'Workspace Agents')
						?? (scenario.cancel ? undefined : items[1]);
				try {
					await vscode.commands.executeCommand('codex-workspace.addAgent');
				} finally {
					restoreInput();
					(vscode.window as unknown as { showInputBox: typeof originalInput }).showInputBox = originalInput;
					(vscode.window as unknown as { showQuickPick: typeof originalPick }).showQuickPick = originalPick;
				}
				const createdPath = path.join(agentsDir, '作成_agent.toml');
				if (scenario.cancel) {
					assert.ok(!fs.existsSync(createdPath));
					assert.strictEqual(fs.readFileSync(configPath, 'utf8'), 'title = "ok"\n');
					return;
				}
				const contents = fs.readFileSync(createdPath, 'utf8');
				if (scenario.template !== undefined) {
					assert.strictEqual(contents, scenario.template);
				} else {
					const parsed = toml.parse(contents);
					const cliRecord = listCliAgentRecords(configPath).find((record) => record.agentPath === createdPath);
					assert.ok(cliRecord);
					assert.strictEqual(cliRecord.name, '作成_agent');
					assert.strictEqual(cliRecord.availability, 'available');
					assert.strictEqual(cliRecord.enabled, true);
					assert.strictEqual(parsed.name, '作成_agent');
					assert.deepStrictEqual(Object.keys(parsed).sort(), ['description', 'developer_instructions', 'name']);
					if (scenario.description.trim()) {
						assert.strictEqual(parsed.description, scenario.description);
						assert.strictEqual(parsed.developer_instructions, scenario.description);
					} else {
						assert.strictEqual(typeof parsed.description, 'string');
						assert.strictEqual(typeof parsed.developer_instructions, 'string');
						assert.match(String(parsed.description), /TODO:/);
						assert.match(String(parsed.developer_instructions), /TODO:/);
					}
				}
			});
		});
	}

	test('addAgent applies selected template contents', async () => {
		await withTempHome(async (homeDir) => {
			const { codexDir, agentsDir } = createWorkspace(homeDir);
			const templateRoot = path.join(codexDir, 'codex-templates');
			fs.mkdirSync(templateRoot, { recursive: true });
			const templatePath = path.join(templateRoot, 'agent-template.toml');
			fs.writeFileSync(
				templatePath,
				'developer_instructions = """\nUse the template.\n"""\nmode = "from-template"\n',
				'utf8',
			);
			await activateExtension();

			const originalInput = vscode.window.showInputBox;
			const originalPick = vscode.window.showQuickPick;
			const restoreQuickPickInput = mockQuickPickTextInputs(['templated']);

			(vscode.window as unknown as { showInputBox: typeof originalInput }).showInputBox =
				async () => 'Template agent';
			(vscode.window as unknown as { showQuickPick: typeof originalPick }).showQuickPick =
				async (items: any) => {
					const workspace = items.find((item: { label?: string }) => item.label === 'Workspace Agents');
					return workspace ?? items[1];
				};

			try {
				await vscode.commands.executeCommand('codex-workspace.addAgent');
			} finally {
				restoreQuickPickInput();
				(vscode.window as unknown as { showInputBox: typeof originalInput }).showInputBox =
					originalInput;
				(vscode.window as unknown as { showQuickPick: typeof originalPick }).showQuickPick =
					originalPick;
			}

			const createdPath = path.join(agentsDir, 'templated.toml');
			const createdContents = fs.readFileSync(createdPath, 'utf8');
			assert.ok(!createdContents.includes('name = "templated"'));
			assert.ok(!createdContents.includes('description = "Template agent"'));
			assert.ok(createdContents.includes('mode = "from-template"'));
			assert.ok(createdContents.includes('developer_instructions = """'));
			assert.strictEqual(createdContents, fs.readFileSync(templatePath, 'utf8'));
		});
	});

	test('addAgent preserves templates without developer_instructions', async () => {
		await withTempHome(async (homeDir) => {
			const { codexDir, agentsDir } = createWorkspace(homeDir);
			const templateRoot = path.join(codexDir, 'codex-templates');
			fs.mkdirSync(templateRoot, { recursive: true });
			fs.writeFileSync(path.join(templateRoot, 'broken.toml'), 'mode = "broken"\n', 'utf8');
			await activateExtension();

			const originalInput = vscode.window.showInputBox;
			const originalPick = vscode.window.showQuickPick;
			const restoreQuickPickInput = mockQuickPickTextInputs(['broken-agent']);

			(vscode.window as unknown as { showInputBox: typeof originalInput }).showInputBox =
				async () => 'Broken agent';
			(vscode.window as unknown as { showQuickPick: typeof originalPick }).showQuickPick =
				async (items: any) => {
					const workspace = items.find((item: { label?: string }) => item.label === 'Workspace Agents');
					return workspace ?? items[1];
				};
			try {
				await vscode.commands.executeCommand('codex-workspace.addAgent');
			} finally {
				restoreQuickPickInput();
				(vscode.window as unknown as { showInputBox: typeof originalInput }).showInputBox =
					originalInput;
				(vscode.window as unknown as { showQuickPick: typeof originalPick }).showQuickPick =
					originalPick;
			}

			const createdPath = path.join(agentsDir, 'broken-agent.toml');
			assert.strictEqual(fs.existsSync(createdPath), true);
			assert.ok(
				!fs.readFileSync(createdPath, 'utf8').includes('developer_instructions = """'),
			);
		});
	});

	test('addAgent notifies when agent file already exists', async () => {
		await withTempHome(async (homeDir) => {
			const { agentsDir, configPath } = createWorkspace(homeDir);
			fs.writeFileSync(path.join(agentsDir, 'exists.toml'), 'old', 'utf8');
			await activateExtension();

			const warnings: string[] = [];
			const originalInput = vscode.window.showInputBox;
			const originalPick = vscode.window.showQuickPick;
			const originalWarning = vscode.window.showWarningMessage;
			const restoreQuickPickInput = mockQuickPickTextInputs(['exists']);

			(vscode.window as unknown as { showInputBox: typeof originalInput }).showInputBox =
				async () => 'desc';
			(vscode.window as unknown as { showQuickPick: typeof originalPick }).showQuickPick =
				async (items: any) =>
					items.find((item: { label?: string }) => item.label === 'Workspace Agents') ?? items[0];
			(vscode.window as unknown as { showWarningMessage: typeof originalWarning })
				.showWarningMessage = async (message: string | vscode.MessageItem) => {
					warnings.push(String(message));
					return undefined;
				};

			try {
				await vscode.commands.executeCommand('codex-workspace.addAgent');
			} finally {
				restoreQuickPickInput();
				(vscode.window as unknown as { showInputBox: typeof originalInput }).showInputBox =
					originalInput;
				(vscode.window as unknown as { showQuickPick: typeof originalPick }).showQuickPick =
					originalPick;
				(vscode.window as unknown as { showWarningMessage: typeof originalWarning })
					.showWarningMessage = originalWarning;
			}

			assert.ok(warnings.length > 0);
			assert.strictEqual(fs.readFileSync(path.join(agentsDir, 'exists.toml'), 'utf8'), 'old');
			const config = fs.readFileSync(configPath, 'utf8');
			assert.ok(!config.includes('[agents.exists]'));
		});
	});

	test('addAgent keeps existing config block and shows warning', async () => {
		await withTempHome(async (homeDir) => {
			const { configPath } = createWorkspace(homeDir);
			fs.writeFileSync(
				configPath,
				[
					'title = "ok"',
					'',
					'[agents.reviewer]',
					'description = "existing"',
					'config_file = "agents/reviewer.toml"',
					'',
				].join('\n'),
				'utf8',
			);
			await activateExtension();

			const warnings: string[] = [];
			const originalInput = vscode.window.showInputBox;
			const originalPick = vscode.window.showQuickPick;
			const originalWarning = vscode.window.showWarningMessage;
			const restoreQuickPickInput = mockQuickPickTextInputs(['reviewer']);

			(vscode.window as unknown as { showInputBox: typeof originalInput }).showInputBox =
				async () => 'new desc';
			(vscode.window as unknown as { showQuickPick: typeof originalPick }).showQuickPick =
				async (items: any) =>
					items.find((item: { label?: string }) => item.label === 'Workspace Agents') ?? items[0];
			(vscode.window as unknown as { showWarningMessage: typeof originalWarning })
				.showWarningMessage = async (message: string | vscode.MessageItem) => {
					warnings.push(String(message));
					return undefined;
				};

			try {
				await vscode.commands.executeCommand('codex-workspace.addAgent');
			} finally {
				restoreQuickPickInput();
				(vscode.window as unknown as { showInputBox: typeof originalInput }).showInputBox =
					originalInput;
				(vscode.window as unknown as { showQuickPick: typeof originalPick }).showQuickPick =
					originalPick;
				(vscode.window as unknown as { showWarningMessage: typeof originalWarning })
					.showWarningMessage = originalWarning;
			}

			assert.ok(warnings.length > 0);
			const headers = fs
				.readFileSync(configPath, 'utf8')
				.split(/\r?\n/)
				.filter((line) => line.trim() === '[agents.reviewer]');
			assert.strictEqual(headers.length, 1);
		});
	});

	test('editAgent updates name, file path, and config block', async () => {
		await withTempHome(async (homeDir) => {
			const { agentsDir, configPath } = createWorkspace(homeDir);
			const currentFilePath = path.join(agentsDir, 'old_name.toml');
			fs.writeFileSync(currentFilePath, 'mode = "x"', 'utf8');
			fs.writeFileSync(
				configPath,
				[
					'title = "ok"',
					'',
					'[agents.old_name]',
					'description = "old"',
					'config_file = "agents/old_name.toml"',
					'',
				].join('\n'),
				'utf8',
			);
			await activateExtension();

			const originalInput = vscode.window.showInputBox;
			const restoreQuickPickInput = mockQuickPickTextInputs(['new_name']);
			(vscode.window as unknown as { showInputBox: typeof originalInput }).showInputBox =
				async () => 'new description';

			try {
				await vscode.commands.executeCommand(
					'codex-workspace.editAgent',
					createAgentItem(currentFilePath),
				);
			} finally {
				restoreQuickPickInput();
				(vscode.window as unknown as { showInputBox: typeof originalInput }).showInputBox =
					originalInput;
			}

			assert.ok(!fs.existsSync(currentFilePath));
			const nextFilePath = path.join(agentsDir, 'new_name.toml');
			assert.ok(fs.existsSync(nextFilePath));
			const nextAgentContents = fs.readFileSync(nextFilePath, 'utf8');
			assert.ok(!nextAgentContents.includes('name = "new_name"'));
			assert.ok(!nextAgentContents.includes('description = "new description"'));
			const config = fs.readFileSync(configPath, 'utf8');
			assert.ok(!config.includes('[agents.old_name]'));
			assert.ok(config.includes('[agents.new_name]'));
			assert.ok(config.includes('description = "new description"'));
			assert.ok(config.includes('config_file = "agents/new_name.toml"'));
		});
	});

	test('deleteAgent removes file, config entry, and disabled stash while keeping sync state', async () => {
		await withTempHome(async (homeDir) => {
			const { codexDir, agentsDir, configPath } = createWorkspace(homeDir);
			const targetPath = path.join(agentsDir, 'to_delete.toml');
			fs.writeFileSync(targetPath, 'mode = "delete"', 'utf8');
			fs.writeFileSync(
				configPath,
				[
					'title = "ok"',
					'',
					'[agents.to_delete]',
					'description = "del"',
					'config_file = "agents/to_delete.toml"',
					'',
				].join('\n'),
				'utf8',
			);
			const disabledStorePath = path.join(
				codexDir,
				'.codex-workspace',
				'agents-disabled.json',
			);
			fs.mkdirSync(path.dirname(disabledStorePath), { recursive: true });
			fs.writeFileSync(
				disabledStorePath,
				JSON.stringify(
					{
						version: 1,
						disabledAgents: {
							to_delete: {
								disabledAt: '2026-02-23T00:00:00.000Z',
								source: 'config.toml',
								block: '[agents.to_delete]\nconfig_file = "agents/to_delete.toml"\n',
							},
						},
					},
					null,
					2,
				),
				'utf8',
			);
			const syncStatePath = path.join(codexDir, '.codex-workspace', 'codex-sync.json');
			fs.mkdirSync(path.dirname(syncStatePath), { recursive: true });
			fs.writeFileSync(
				syncStatePath,
				JSON.stringify(
					{
						agents: {
							'to_delete.toml': true,
						},
					},
					null,
					2,
				),
				'utf8',
			);
			await activateExtension();

			const originalWarning = vscode.window.showWarningMessage;
			(vscode.window as unknown as { showWarningMessage: typeof originalWarning })
				.showWarningMessage = async () => 'OK';

			try {
				await vscode.commands.executeCommand(
					'codex-workspace.deleteAgent',
					createAgentItem(targetPath),
				);
			} finally {
				(vscode.window as unknown as { showWarningMessage: typeof originalWarning })
					.showWarningMessage = originalWarning;
			}

			assert.ok(!fs.existsSync(targetPath));
			const nextConfig = fs.readFileSync(configPath, 'utf8');
			assert.ok(!nextConfig.includes('[agents.to_delete]'));
			assert.strictEqual(fs.existsSync(disabledStorePath), false);
			const syncState = JSON.parse(fs.readFileSync(syncStatePath, 'utf8')) as {
				agents?: Record<string, unknown>;
			};
			assert.strictEqual(syncState.agents?.['to_delete.toml'], true);
		});
	});

	test('disableAgent removes config block and stores raw block with comments', async () => {
		await withTempHome(async (homeDir) => {
			const { codexDir, agentsDir, configPath } = createWorkspace(homeDir);
			const targetPath = path.join(agentsDir, 'reviewer.toml');
			fs.writeFileSync(targetPath, 'mode = "review"', 'utf8');
			fs.writeFileSync(
				configPath,
				[
					'title = "ok"',
					'',
					'[agents.reviewer]',
					'# keep this comment',
					'description = "reviewer"',
					'config_file = "agents/reviewer.toml"',
					'',
				].join('\n'),
				'utf8',
			);
			await activateExtension();

			const infos: string[] = [];
			const originalInfo = vscode.window.showInformationMessage;
			(vscode.window as unknown as { showInformationMessage: typeof originalInfo })
				.showInformationMessage = async (message: string | vscode.MessageItem) => {
					infos.push(String(message));
					return undefined;
				};

			try {
				await vscode.commands.executeCommand(
					'codex-workspace.disableAgent',
					createAgentItem(targetPath),
				);
			} finally {
				(vscode.window as unknown as { showInformationMessage: typeof originalInfo })
					.showInformationMessage = originalInfo;
			}

			const nextConfig = fs.readFileSync(configPath, 'utf8');
			assert.ok(!nextConfig.includes('[agents.reviewer]'));
			assert.ok(infos.length > 0);

			const storePath = path.join(codexDir, '.codex-workspace', 'agents-disabled.json');
			const store = JSON.parse(fs.readFileSync(storePath, 'utf8')) as {
				version: number;
				disabledAgents: Record<string, { block: string }>;
			};
			assert.strictEqual(store.version, 1);
			assert.ok(store.disabledAgents.reviewer.block.includes('# keep this comment'));
		});
	});

	test('enableAgent restores stashed block and clears store entry', async () => {
		await withTempHome(async (homeDir) => {
			const { codexDir, agentsDir, configPath } = createWorkspace(homeDir);
			const targetPath = path.join(agentsDir, 'restorable.toml');
			fs.writeFileSync(targetPath, 'mode = "x"', 'utf8');
			const storePath = path.join(codexDir, '.codex-workspace', 'agents-disabled.json');
			fs.mkdirSync(path.dirname(storePath), { recursive: true });
			fs.writeFileSync(
				storePath,
				JSON.stringify(
					{
						version: 1,
						disabledAgents: {
							restorable: {
								disabledAt: '2026-02-23T00:00:00.000Z',
								source: 'config.toml',
								block: '[agents.restorable]\n# from stash\ndescription = "stash"\nconfig_file = "agents/restorable.toml"\n',
							},
						},
					},
					null,
					2,
				),
				'utf8',
			);
			await activateExtension();

			await vscode.commands.executeCommand(
				'codex-workspace.enableAgent',
				createAgentItem(targetPath),
			);

			const nextConfig = fs.readFileSync(configPath, 'utf8');
			assert.ok(nextConfig.includes('[agents.restorable]'));
			assert.ok(nextConfig.includes('# from stash'));
			const nextAgentContents = fs.readFileSync(targetPath, 'utf8');
			assert.ok(!nextAgentContents.includes('name = "restorable"'));

			assert.strictEqual(fs.existsSync(storePath), false);
		});
	});

	test('Explorer enable and disable failures retain recovery data without success notification', async () => {
		await withTempHome(async (homeDir) => {
			const { codexDir, agentsDir, configPath } = createWorkspace(homeDir);
			const targetPath = path.join(agentsDir, 'reviewer.toml');
			fs.writeFileSync(targetPath, 'model = "keep"\n');
			const declaration = '[agents.reviewer]\ndescription = "keep"\nconfig_file = "agents/reviewer.toml"\n[agents.reviewer.features]\nshell_tool = false\n';
			fs.writeFileSync(configPath, declaration);
			await activateExtension();
			const originalRename = fs.renameSync;
			const originalInfo = vscode.window.showInformationMessage;
			const originalError = vscode.window.showErrorMessage;
			let infos = 0;
			let errors = 0;
			vscode.window.showInformationMessage = (async () => { infos += 1; }) as typeof originalInfo;
			vscode.window.showErrorMessage = (async () => { errors += 1; }) as typeof originalError;
			try {
				fs.renameSync = (source, destination) => {
					if (String(destination) === configPath) { throw new Error('EACCES injected'); }
					originalRename(source, destination);
				};
				await vscode.commands.executeCommand('codex-workspace.disableAgent', createAgentItem(targetPath));
				assert.strictEqual(infos, 0);
				assert.strictEqual(errors, 1);
				assert.strictEqual(fs.readFileSync(configPath, 'utf8'), declaration);
				fs.renameSync = originalRename;
				await vscode.commands.executeCommand('codex-workspace.disableAgent', createAgentItem(targetPath));
				const storePath = path.join(codexDir, '.codex-workspace', 'agents-disabled.json');
				const backup = fs.readFileSync(storePath, 'utf8');
				const disabled = fs.readFileSync(configPath, 'utf8');
				infos = 0;
				fs.renameSync = () => { throw new Error('EACCES injected'); };
				await vscode.commands.executeCommand('codex-workspace.enableAgent', createAgentItem(targetPath));
				assert.strictEqual(errors, 2);
				assert.strictEqual(infos, 0);
				assert.strictEqual(fs.readFileSync(configPath, 'utf8'), disabled);
				assert.strictEqual(fs.readFileSync(storePath, 'utf8'), backup);
				fs.renameSync = originalRename;
				await vscode.commands.executeCommand('codex-workspace.enableAgent', createAgentItem(targetPath));
				assert.ok(fs.readFileSync(configPath, 'utf8').includes('shell_tool = false'));
				assert.strictEqual(infos, 1);
			} finally {
				fs.renameSync = originalRename;
				vscode.window.showInformationMessage = originalInfo;
				vscode.window.showErrorMessage = originalError;
			}
		});
	});

	test('enableAgent falls back to minimal block when stash is missing', async () => {
		await withTempHome(async (homeDir) => {
			const { agentsDir, configPath } = createWorkspace(homeDir);
			const targetPath = path.join(agentsDir, 'fallback.toml');
			fs.writeFileSync(targetPath, 'mode = "x"', 'utf8');
			await activateExtension();

			await vscode.commands.executeCommand(
				'codex-workspace.enableAgent',
				createAgentItem(targetPath),
			);

			const nextConfig = fs.readFileSync(configPath, 'utf8');
			assert.ok(nextConfig.includes('[agents.fallback]'));
			assert.ok(nextConfig.includes('description = ""'));
			assert.ok(nextConfig.includes('config_file = "agents/fallback.toml"'));
			const nextAgentContents = fs.readFileSync(targetPath, 'utf8');
			assert.ok(!nextAgentContents.includes('name = "fallback"'));
		});
	});
});
