import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

suite('Agent menu contributions', () => {
	test('agent commands are contributed to view title and item context', () => {
		const packageJsonPath = path.resolve(__dirname, '..', '..', 'package.json');
		const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

		const commands = packageJson?.contributes?.commands as
			| Array<{ command?: string; icon?: string }>
			| undefined;
		assert.ok(Array.isArray(commands));
		for (const commandId of [
			'codex-workspace.addAgent',
			'codex-workspace.editAgent',
			'codex-workspace.deleteAgent',
		]) {
			const entry = commands?.find((command) => command.command === commandId);
			assert.ok(entry, `Missing command ${commandId}`);
			assert.ok(entry?.icon, `Missing icon for ${commandId}`);
		}
		for (const commandId of [
			'codex-workspace.enableAgent',
			'codex-workspace.disableAgent',
		]) {
			const entry = commands?.find((command) => command.command === commandId);
			assert.ok(entry, `Missing command ${commandId}`);
			assert.ok(entry?.icon, `Missing icon for ${commandId}`);
		}

		const viewTitle = packageJson?.contributes?.menus?.['view/title'] as
			| Array<{ command?: string; when?: string }>
			| undefined;
		assert.ok(Array.isArray(viewTitle));
		const addAgentMenu = viewTitle?.find(
			(item) => item.command === 'codex-workspace.addAgent',
		);
		assert.ok(addAgentMenu);
		assert.ok(addAgentMenu?.when?.includes("view == 'codex-workspace.agents'"));
		for (const commandId of [
			'codex-workspace.editAgent',
			'codex-workspace.deleteAgent',
		]) {
			const entry = viewTitle?.find((item) => item.command === commandId);
			assert.ok(entry, `Missing view/title menu for ${commandId}`);
			assert.ok(entry?.when?.includes("view == 'codex-workspace.agents'"));
		}

		const itemContext = packageJson?.contributes?.menus?.['view/item/context'] as
			| Array<{ command?: string; when?: string }>
			| undefined;
		assert.ok(Array.isArray(itemContext));

		const enableMenu = itemContext?.find(
			(item) => item.command === 'codex-workspace.enableAgent',
		);
		assert.ok(enableMenu);
		assert.ok(enableMenu?.when?.includes("view == 'codex-workspace.agents'"));
		assert.ok(enableMenu?.when?.includes("viewItem == 'codex-agent-file-disabled'"));

		const disableMenu = itemContext?.find(
			(item) => item.command === 'codex-workspace.disableAgent',
		);
		assert.ok(disableMenu);
		assert.ok(disableMenu?.when?.includes("view == 'codex-workspace.agents'"));
		assert.ok(disableMenu?.when?.includes("viewItem == 'codex-agent-file-enabled'"));
	});
});
