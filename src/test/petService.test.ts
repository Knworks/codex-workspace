import * as assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { listAvailablePets } from '../services/petService';
import { mapCodexStatusToPetRateLimits } from '../services/petRateLimitService';

suite('Pet services', () => {
	test('lists only valid pets with safe sprite paths', () => {
		const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-pet-home-'));
		try {
			const petRoot = path.join(homeDir, '.codex', 'pet');
			const validPetRoot = path.join(petRoot, 'frieren');
			fs.mkdirSync(validPetRoot, { recursive: true });
			fs.writeFileSync(
				path.join(validPetRoot, 'pet.json'),
				JSON.stringify({
					id: 'frieren',
					displayName: 'Frieren',
					description: 'tiny mage',
					spritesheetPath: 'spritesheet.webp',
				}),
				'utf8',
			);
			fs.writeFileSync(path.join(validPetRoot, 'spritesheet.webp'), 'ok', 'utf8');

			const invalidPetRoot = path.join(petRoot, 'invalid');
			fs.mkdirSync(invalidPetRoot, { recursive: true });
			fs.writeFileSync(
				path.join(invalidPetRoot, 'pet.json'),
				JSON.stringify({
					id: 'invalid',
					displayName: 'Invalid',
					spritesheetPath: '../outside.webp',
				}),
				'utf8',
			);

			const pets = listAvailablePets(homeDir);
			assert.strictEqual(pets.length, 1);
			assert.strictEqual(pets[0]?.id, 'frieren');
			assert.strictEqual(pets[0]?.spritesheetPath, 'spritesheet.webp');
		} finally {
			fs.rmSync(homeDir, { recursive: true, force: true });
		}
	});

	test('prefers .codex/pets when present', () => {
		const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-pet-home-'));
		try {
			const petRoot = path.join(homeDir, '.codex', 'pets', 'chopper');
			fs.mkdirSync(petRoot, { recursive: true });
			fs.writeFileSync(
				path.join(petRoot, 'pet.json'),
				JSON.stringify({
					id: 'chopper',
					displayName: 'Chopper',
					spritesheetPath: 'spritesheet.webp',
				}),
				'utf8',
			);
			fs.writeFileSync(path.join(petRoot, 'spritesheet.webp'), 'ok', 'utf8');

			const pets = listAvailablePets(homeDir);
			assert.strictEqual(pets.length, 1);
			assert.strictEqual(pets[0]?.id, 'chopper');
		} finally {
			fs.rmSync(homeDir, { recursive: true, force: true });
		}
	});

	test('falls back to folder name when id and displayName are omitted', () => {
		const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-pet-home-'));
		try {
			const petRoot = path.join(homeDir, '.codex', 'pet', 'fern');
			fs.mkdirSync(petRoot, { recursive: true });
			fs.writeFileSync(
				path.join(petRoot, 'pet.json'),
				JSON.stringify({
					spritesheetPath: 'spritesheet.webp',
				}),
				'utf8',
			);
			fs.writeFileSync(path.join(petRoot, 'spritesheet.webp'), 'ok', 'utf8');

			const pets = listAvailablePets(homeDir);
			assert.strictEqual(pets.length, 1);
			assert.strictEqual(pets[0]?.id, 'fern');
			assert.strictEqual(pets[0]?.displayName, 'fern');
		} finally {
			fs.rmSync(homeDir, { recursive: true, force: true });
		}
	});

	test('maps codex status payload to pet rate limit cards', () => {
		const snapshot = mapCodexStatusToPetRateLimits({
			rateLimits: {
				primary: {
					usedPercent: 0,
					windowDurationMins: 300,
					resetsAt: 1777534802,
				},
				secondary: {
					usedPercent: 76,
					windowDurationMins: 10080,
					resetsAt: 1777969707,
				},
			},
		});

		assert.ok(snapshot);
		assert.strictEqual(snapshot?.windows.length, 2);
		assert.deepStrictEqual(
			snapshot?.windows.map((window) => ({
				label: window.label,
				remainingPercent: window.remainingPercent,
				isWarning: window.isWarning,
			})),
			[
				{ label: '1w', remainingPercent: 24, isWarning: true },
				{ label: '5h', remainingPercent: 100, isWarning: false },
			],
		);
	});
});
