import * as assert from 'assert';
import {
	getConfiguredMaxHistoryCount,
	getIncludeReasoningMessage,
	getSyncSettings,
} from '../services/settings';

type ConfigurationReader = {
	get: <T>(key: string) => T | undefined;
	inspect: <T>(key: string) =>
		| {
				key: string;
				globalValue?: T;
				workspaceValue?: T;
				workspaceFolderValue?: T;
		  }
		| undefined;
};

const createConfig = (values: Record<string, unknown>): ConfigurationReader => ({
	get: <T>(key: string) => values[key] as T | undefined,
	inspect: <T>(key: string) => {
		if (!Object.prototype.hasOwnProperty.call(values, key)) {
			return undefined;
		}
		return {
			key,
			globalValue: values[key] as T,
		};
	},
});

suite('Sync settings', () => {
	test('returns configured values', () => {
		const config = createConfig({
			codexFolder: '/tmp/codex',
			promptsFolder: '/tmp/prompts',
			skillsFolder: '/tmp/skills',
			templatesFolder: '/tmp/templates',
		});

		const settings = getSyncSettings(config);

		assert.deepStrictEqual(settings, {
			codexFolder: '/tmp/codex',
			promptsFolder: '/tmp/prompts',
			skillsFolder: '/tmp/skills',
			templatesFolder: '/tmp/templates',
		});
	});

	test('returns empty strings when values are missing', () => {
		const config = createConfig({});

		const settings = getSyncSettings(config);

		assert.deepStrictEqual(settings, {
			codexFolder: '',
			promptsFolder: '',
			skillsFolder: '',
			templatesFolder: '',
		});
	});

	test('returns configured max history count when explicitly set', () => {
		const config = createConfig({ maxHistoryCount: 42 });

		const maxHistoryCount = getConfiguredMaxHistoryCount(config);

		assert.strictEqual(maxHistoryCount, 42);
	});

	test('returns undefined max history count when not configured', () => {
		const config = createConfig({});

		const maxHistoryCount = getConfiguredMaxHistoryCount(config);

		assert.strictEqual(maxHistoryCount, undefined);
	});

	test('returns undefined max history count for non-positive values', () => {
		const config = createConfig({ maxHistoryCount: 0 });

		const maxHistoryCount = getConfiguredMaxHistoryCount(config);

		assert.strictEqual(maxHistoryCount, undefined);
	});

	test('returns false for include reasoning message when not configured', () => {
		const config = createConfig({});

		const includeReasoningMessage = getIncludeReasoningMessage(config);

		assert.strictEqual(includeReasoningMessage, false);
	});

	test('returns configured include reasoning message flag', () => {
		const config = createConfig({ incrudeReasoningMessage: true });

		const includeReasoningMessage = getIncludeReasoningMessage(config);

		assert.strictEqual(includeReasoningMessage, true);
	});
});
