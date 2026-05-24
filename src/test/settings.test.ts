import * as assert from 'assert';
import {
	getConfiguredMaxHistoryCount,
	getIncludeReasoningMessage,
	getPetSettings,
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
			agentFolder: '/tmp/agents',
		});

		const settings = getSyncSettings(config);

		assert.deepStrictEqual(settings, {
			codexFolder: '/tmp/codex',
			promptsFolder: '/tmp/prompts',
			skillsFolder: '/tmp/skills',
			templatesFolder: '/tmp/templates',
			agentFolder: '/tmp/agents',
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
			agentFolder: '',
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

	test('returns default pet settings when values are missing', () => {
		const settings = getPetSettings(createConfig({}));

		assert.deepStrictEqual(settings, {
			enabled: true,
			appServerEnabled: false,
			rateLimitRefreshMinutes: 5,
			scale: 1,
			selectedPetId: '',
		});
	});

	test('clamps pet settings to allowed ranges', () => {
		const settings = getPetSettings(
			createConfig({
				'pet.enabled': false,
				'pet.appServer.enabled': true,
				'pet.rateLimitRefreshMinutes': 99,
				'pet.scale': 3.7,
				'pet.selectedPetId': 'frieren',
			}),
		);

		assert.deepStrictEqual(settings, {
			enabled: false,
			appServerEnabled: true,
			rateLimitRefreshMinutes: 60,
			scale: 2,
			selectedPetId: 'frieren',
		});
	});

	test('clamps pet scale down to 0.5', () => {
		const settings = getPetSettings(
			createConfig({
				'pet.scale': 0.04,
			}),
		);

		assert.strictEqual(settings.scale, 0.5);
	});

	test('keeps legacy explicit scale 0.5 at the new default visual size', () => {
		const settings = getPetSettings(
			createConfig({
				'pet.scale': 0.5,
			}),
		);

		assert.strictEqual(settings.scale, 1);
	});

	test('keeps fractional refresh intervals like 0.1 minutes', () => {
		const settings = getPetSettings(
			createConfig({
				'pet.rateLimitRefreshMinutes': 0.1,
			}),
		);

		assert.strictEqual(settings.rateLimitRefreshMinutes, 0.1);
	});
});
