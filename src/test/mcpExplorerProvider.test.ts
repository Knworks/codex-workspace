import * as assert from 'assert';
import * as vscode from 'vscode';
import { McpExplorerProvider } from '../views/mcpExplorerProvider';
import * as mcpService from '../services/mcpService';

suite('MCP explorer provider', () => {
	test('uses codicon status icons for enabled and disabled servers', () => {
		const originalReadMcpServers = mcpService.readMcpServers;
		try {
			(mcpService as unknown as { readMcpServers: typeof mcpService.readMcpServers }).readMcpServers =
				() => [
					{ id: 'github', enabled: true, headerLineIndex: 0 },
					{ id: 'remote', enabled: false, headerLineIndex: 3 },
				];

			const provider = new McpExplorerProvider({} as vscode.ExtensionContext);
			const items = provider.getChildren() as vscode.TreeItem[];

			assert.deepStrictEqual(
				items.map((item) => item.label),
				['github', 'remote'],
			);

			assert.ok(items[0].iconPath instanceof vscode.ThemeIcon);
			assert.strictEqual((items[0].iconPath as vscode.ThemeIcon).id, 'mcp');
			assert.strictEqual((items[0].iconPath as vscode.ThemeIcon).color, undefined);

			assert.ok(items[1].iconPath instanceof vscode.ThemeIcon);
			assert.strictEqual((items[1].iconPath as vscode.ThemeIcon).id, 'circle-slash');
			assert.strictEqual(
				(items[1].iconPath as vscode.ThemeIcon).color?.id,
				'disabledForeground',
			);
		} finally {
			(mcpService as unknown as { readMcpServers: typeof mcpService.readMcpServers }).readMcpServers =
				originalReadMcpServers;
		}
	});
});
