import * as assert from 'assert';
import fs from 'fs';
import path from 'path';

suite('View title menus', () => {
	test('Common actions are contributed to prompts/skills/templates view titles', () => {
		const packageJsonPath = path.resolve(__dirname, '..', '..', 'package.json');
		const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

		const menus = packageJson?.contributes?.menus;
		assert.ok(menus);
		assert.ok(!menus['viewContainer/title']);

		const viewTitle = menus['view/title'];
		assert.ok(Array.isArray(viewTitle));
		const itemContext = menus['view/item/context'];
		assert.ok(Array.isArray(itemContext));

		const commandDefinitions = packageJson?.contributes?.commands;
		assert.ok(Array.isArray(commandDefinitions));

		const commonCommands = [
			'codex-workspace.delete',
			'codex-workspace.rename',
			'codex-workspace.refreshAll',
		];

		const viewIds = [
			'codex-workspace.prompts',
			'codex-workspace.skills',
			'codex-workspace.templates',
		];

		const perViewCommands = [
			{
				command: 'codex-workspace.addPromptsFile',
				viewId: 'codex-workspace.prompts',
			},
			{
				command: 'codex-workspace.addSkillsRootFolder',
				viewId: 'codex-workspace.skills',
			},
			{
				command: 'codex-workspace.addTemplatesRootFolder',
				viewId: 'codex-workspace.templates',
			},
			{
				command: 'codex-workspace.addTemplatesFile',
				viewId: 'codex-workspace.templates',
			},
			{
				command: 'codex-workspace.openPromptsFolder',
				viewId: 'codex-workspace.prompts',
			},
			{
				command: 'codex-workspace.openSkillsFolder',
				viewId: 'codex-workspace.skills',
			},
			{
				command: 'codex-workspace.openTemplatesFolder',
				viewId: 'codex-workspace.templates',
			},
			{
				command: 'codex-workspace.openAgentsFolder',
				viewId: 'codex-workspace.agents',
			},
			{
				command: 'codex-workspace.addAgent',
				viewId: 'codex-workspace.agents',
			},
			{
				command: 'codex-workspace.openCodexFolder',
				viewId: 'codex-workspace.core',
			},
			{
				command: 'codex-workspace.openHistoryView',
				viewId: 'codex-workspace.core',
			},
			{
				command: 'codex-workspace.selectPet',
				viewId: 'codex-workspace.pet',
			},
			{
				command: 'codex-workspace.connectPetAppServer',
				viewId: 'codex-workspace.pet',
			},
			{
				command: 'codex-workspace.disconnectPetAppServer',
				viewId: 'codex-workspace.pet',
			},
		];

		const syncCommands = [
			{
				command: 'codex-workspace.syncCore',
				viewId: 'codex-workspace.core',
				configKey: 'config.codex-workspace.codexFolder',
			},
			{
				command: 'codex-workspace.syncPrompts',
				viewId: 'codex-workspace.prompts',
				configKey: 'config.codex-workspace.promptsFolder',
			},
			{
				command: 'codex-workspace.syncSkills',
				viewId: 'codex-workspace.skills',
				configKey: 'config.codex-workspace.skillsFolder',
			},
			{
				command: 'codex-workspace.syncTemplates',
				viewId: 'codex-workspace.templates',
				configKey: 'config.codex-workspace.templatesFolder',
			},
			{
				command: 'codex-workspace.syncAgents',
				viewId: 'codex-workspace.agents',
				configKey: 'config.codex-workspace.agentFolder',
			},
		];

		const managerCommands = [
			'codex-workspace.openSkillManager',
			'codex-workspace.openAgentManager',
			'codex-workspace.openMcpManager',
		];
		const excludedViewIds = ['codex-workspace.mcp', 'codex-workspace.menu'];

		const assertCommandDefinition = (command: string): void => {
			const commandEntry = commandDefinitions.find(
				(item: { command?: string }) => item.command === command,
			);
			assert.ok(commandEntry, `Missing command definition for ${command}`);
			assert.ok(commandEntry.icon, `Missing icon for ${command}`);
		};

		for (const command of commonCommands) {
			assertCommandDefinition(command);
			const entry = viewTitle.find(
				(item: { command?: string }) => item.command === command,
			);
			assert.ok(entry, `Missing view/title menu for ${command}`);
			const when = entry.when ?? '';
			const targetViewIds =
				command === 'codex-workspace.refreshAll'
					? [...viewIds, 'codex-workspace.mcp', 'codex-workspace.agents', 'codex-workspace.pet']
					: viewIds;
			const excludedForCommand =
				command === 'codex-workspace.refreshAll'
					? ['codex-workspace.menu']
					: excludedViewIds;
			for (const viewId of targetViewIds) {
				assert.ok(
					when.includes(`view == '${viewId}'`),
					`${command} is missing view condition for ${viewId}`,
				);
			}
			for (const viewId of excludedForCommand) {
				assert.ok(
					!when.includes(`view == '${viewId}'`),
					`${command} should not target ${viewId}`,
				);
			}
		}

		const perViewIds = [...viewIds, 'codex-workspace.core', 'codex-workspace.agents', 'codex-workspace.pet'];
		const commandsWithView = [...perViewCommands, ...syncCommands];

		for (const { command, viewId } of commandsWithView) {
			assertCommandDefinition(command);
			const entry = viewTitle.find(
				(item: { command?: string }) => item.command === command,
			);
			assert.ok(entry, `Missing view/title menu for ${command}`);
			const when = entry.when ?? '';
			assert.ok(
				when.includes(`view == '${viewId}'`),
				`${command} is missing view condition for ${viewId}`,
			);
			for (const otherViewId of perViewIds.filter((id) => id !== viewId)) {
				assert.ok(
					!when.includes(`view == '${otherViewId}'`),
					`${command} should not target ${otherViewId}`,
				);
			}
			for (const excludedViewId of excludedViewIds) {
				assert.ok(
					!when.includes(`view == '${excludedViewId}'`),
					`${command} should not target ${excludedViewId}`,
				);
			}
		}

		const addSkillsRootFolderCommand = commandDefinitions.find(
			(item: { command?: string; title?: string }) =>
				item.command === 'codex-workspace.addSkillsRootFolder',
		);
		assert.strictEqual(
			addSkillsRootFolderCommand?.title,
			'%command.addSkillFolder%',
		);

		for (const { command, configKey } of syncCommands) {
			const entry = viewTitle.find(
				(item: { command?: string }) => item.command === command,
			);
			assert.ok(entry, `Missing view/title menu for ${command}`);
			const when = entry.when ?? '';
			assert.ok(
				when.includes(configKey),
				`${command} is missing config condition`,
			);
		}

		const petConnectEntry = viewTitle.find(
			(item: { command?: string }) =>
				item.command === 'codex-workspace.connectPetAppServer',
		);
		assert.ok(petConnectEntry, 'Missing view/title menu for codex-workspace.connectPetAppServer');
		assert.ok(
			(petConnectEntry.when ?? '').includes('config.codex-workspace.pet.appServer.enabled'),
			'codex-workspace.connectPetAppServer is missing config condition',
		);
		assert.ok(
			(petConnectEntry.when ?? '').includes('!codex-workspace.pet.appServer.connected'),
			'codex-workspace.connectPetAppServer is missing disconnected-state condition',
		);

		const petDisconnectEntry = viewTitle.find(
			(item: { command?: string }) =>
				item.command === 'codex-workspace.disconnectPetAppServer',
		);
		assert.ok(petDisconnectEntry, 'Missing view/title menu for codex-workspace.disconnectPetAppServer');
		assert.ok(
			(petDisconnectEntry.when ?? '').includes('config.codex-workspace.pet.appServer.enabled'),
			'codex-workspace.disconnectPetAppServer is missing config condition',
		);
		assert.ok(
			(petDisconnectEntry.when ?? '').includes('codex-workspace.pet.appServer.connected'),
			'codex-workspace.disconnectPetAppServer is missing connected-state condition',
		);

		for (const command of managerCommands) {
			const entry = viewTitle.find(
				(item: { command?: string }) => item.command === command,
			);
			assert.ok(entry, `Missing view/title menu for ${command}`);
			const when = entry.when ?? '';
			assert.ok(
				!when.includes("view == 'codex-workspace.prompts'"),
				`${command} should not target prompts view`,
			);
			assert.ok(
				!when.includes("view == 'codex-workspace.templates'"),
				`${command} should not target templates view`,
			);
		}

		for (const command of [
			'codex-workspace.addSkillsFolder',
			'codex-workspace.addSkillsFile',
			'codex-workspace.addTemplatesFolder',
			'codex-workspace.addTemplatesFile',
		]) {
			assertCommandDefinition(command);
			const entry = itemContext.find(
				(item: { command?: string }) => item.command === command,
			);
			assert.ok(entry, `Missing view/item/context menu for ${command}`);
			const when = entry.when ?? '';
			assert.ok(
				when.includes(
					command.includes('Templates')
						? "view == 'codex-workspace.templates'"
						: "view == 'codex-workspace.skills'",
				),
				`${command} is missing view condition`,
			);
			assert.ok(
				when.includes("viewItem == 'codex-folder'"),
				`${command} should target codex-folder`,
			);
			assert.ok(
				when.includes("viewItem == 'codex-root'"),
				`${command} should target codex-root`,
			);
		}
	});
});
