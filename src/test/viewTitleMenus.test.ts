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

		const commandDefinitions = packageJson?.contributes?.commands;
		assert.ok(Array.isArray(commandDefinitions));

		const commonCommands = [
			'codex-workspace.addFolder',
			'codex-workspace.addFile',
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
				command: 'codex-workspace.openCodexFolder',
				viewId: 'codex-workspace.core',
			},
		];

		const excludedViewIds = [
			'codex-workspace.mcp',
			'codex-workspace.menu',
		];

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
			for (const viewId of viewIds) {
				assert.ok(
					when.includes(`view == '${viewId}'`),
					`${command} is missing view condition for ${viewId}`,
				);
			}
			for (const viewId of excludedViewIds) {
				assert.ok(
					!when.includes(`view == '${viewId}'`),
					`${command} should not target ${viewId}`,
				);
			}
		}

		const perViewIds = [...viewIds, 'codex-workspace.core'];

		for (const { command, viewId } of perViewCommands) {
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
	});
});
