import * as assert from 'assert';
import { getSyncSettings } from '../services/settings';

type ConfigurationReader = {
	get: <T>(key: string) => T | undefined;
};

const createConfig = (values: Record<string, unknown>): ConfigurationReader => ({
	get: <T>(key: string) => values[key] as T | undefined,
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
});
