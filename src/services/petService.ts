import fs from 'fs';
import os from 'os';
import path from 'path';
import { resolveCodexPaths } from './workspaceStatus';

export type PetDefinition = {
	id: string;
	displayName: string;
	description: string;
	spritesheetPath: string;
	petRootPath: string;
	spritesheetFsPath: string;
};

type RawPetDefinition = {
	id?: unknown;
	displayName?: unknown;
	description?: unknown;
	spritesheetPath?: unknown;
};

export function getPetRootCandidates(homeDir: string = os.homedir()): string[] {
	const codexDir = resolveCodexPaths(homeDir).codexDir;
	return [
		path.join(codexDir, 'pets'),
		path.join(codexDir, 'pet'),
	];
}

export function getPetRootPath(homeDir: string = os.homedir()): string {
	return getPetRootCandidates(homeDir).find((candidate) => fs.existsSync(candidate))
		?? getPetRootCandidates(homeDir)[0];
}

function isExternalUrl(value: string): boolean {
	return /^[a-z][a-z0-9+.-]*:\/\//i.test(value);
}

function normalizePetRecord(
	petRootPath: string,
	raw: RawPetDefinition,
): PetDefinition | undefined {
	const fallbackId = path.basename(petRootPath);
	if (
		typeof raw.spritesheetPath !== 'string'
		|| raw.spritesheetPath.trim().length === 0
	) {
		return undefined;
	}

	const spritesheetPath = raw.spritesheetPath.trim();
	if (
		path.isAbsolute(spritesheetPath)
		|| isExternalUrl(spritesheetPath)
	) {
		return undefined;
	}

	const spritesheetFsPath = path.resolve(petRootPath, spritesheetPath);
	const relative = path.relative(petRootPath, spritesheetFsPath);
	if (
		relative.startsWith('..')
		|| path.isAbsolute(relative)
		|| !fs.existsSync(spritesheetFsPath)
	) {
		return undefined;
	}

	return {
		id:
			typeof raw.id === 'string' && raw.id.trim().length > 0
				? raw.id.trim()
				: fallbackId,
		displayName:
			typeof raw.displayName === 'string' && raw.displayName.trim().length > 0
				? raw.displayName.trim()
				: fallbackId,
		description:
			typeof raw.description === 'string'
				? raw.description.trim()
				: '',
		spritesheetPath,
		petRootPath,
		spritesheetFsPath,
	};
}

export function listAvailablePets(homeDir?: string): PetDefinition[] {
	const petRoot = getPetRootPath(homeDir);
	if (!fs.existsSync(petRoot)) {
		return [];
	}

	const pets: PetDefinition[] = [];
	for (const entry of fs.readdirSync(petRoot, { withFileTypes: true })) {
		if (!entry.isDirectory()) {
			continue;
		}
		const petDir = path.join(petRoot, entry.name);
		const petJsonPath = path.join(petDir, 'pet.json');
		if (!fs.existsSync(petJsonPath)) {
			continue;
		}

		try {
			const raw = JSON.parse(
				fs.readFileSync(petJsonPath, 'utf8'),
			) as RawPetDefinition;
			const normalized = normalizePetRecord(petDir, raw);
			if (normalized) {
				pets.push(normalized);
			}
		} catch {
			// Ignore invalid pet definitions and keep the list resilient.
		}
	}

	return pets.sort((left, right) =>
		left.displayName.localeCompare(right.displayName),
	);
}

export function findPetById(
	petId: string,
	homeDir?: string,
): PetDefinition | undefined {
	return listAvailablePets(homeDir).find((pet) => pet.id === petId);
}
