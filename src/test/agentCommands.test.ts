import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { CodexTreeItem } from '../models/treeItems';

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
	test('addAgent executes name -> description -> template and creates empty file', async () => {
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
			assert.ok(createdContents.includes('name = "reviewer"'));
			assert.ok(createdContents.includes('description = "Security reviewer"'));
			const config = fs.readFileSync(configPath, 'utf8');
			assert.ok(config.includes('[agents.reviewer]'));
			assert.ok(config.includes('description = "Security reviewer"'));
			assert.ok(config.includes('config_file = "agents/reviewer.toml"'));
		});
	});

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
			assert.ok(createdContents.includes('name = "templated"'));
			assert.ok(createdContents.includes('description = "Template agent"'));
			assert.ok(createdContents.includes('mode = "from-template"'));
			assert.ok(createdContents.includes('developer_instructions = """'));
		});
	});

	test('addAgent synthesizes developer_instructions when the template omits it', async () => {
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
				fs.readFileSync(createdPath, 'utf8').includes('developer_instructions = """'),
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
			assert.ok(nextAgentContents.includes('name = "new_name"'));
			assert.ok(nextAgentContents.includes('description = "new description"'));
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
			const disabledStore = JSON.parse(
				fs.readFileSync(disabledStorePath, 'utf8'),
			) as { disabledAgents: Record<string, unknown> };
			assert.strictEqual(disabledStore.disabledAgents.to_delete, undefined);
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
			assert.ok(nextAgentContents.includes('name = "restorable"'));

			const store = JSON.parse(fs.readFileSync(storePath, 'utf8')) as {
				disabledAgents: Record<string, unknown>;
			};
			assert.strictEqual(store.disabledAgents.restorable, undefined);
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
			assert.ok(nextAgentContents.includes('name = "fallback"'));
		});
	});
});
