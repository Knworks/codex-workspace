export function parseFeatureList(output) {
	const keys = new Set();
	return output.trim().split(/\r?\n/).map((line) => {
		const match = line.match(/^([\w.]+)\s+(stable|experimental|under development|deprecated|removed)\s+(true|false)\s*$/);
		if (!match || keys.has(match[1])) {
			throw new Error(`Unexpected or duplicate feature row: ${line}`);
		}
		keys.add(match[1]);
		return { key: match[1], stage: match[2], defaultEnabled: match[3] === 'true' };
	}).sort((left, right) => left.key.localeCompare(right.key, 'en'));
}

export function compareFeatureCatalog(previous, current) {
	const oldFeatures = new Map(previous.features.map((feature) => [feature.key, feature]));
	const newFeatures = new Map(current.features.map((feature) => [feature.key, feature]));
	const changes = [];
	if (previous.version !== current.version) {
		changes.push(`Version: ${previous.version ?? '(none)'} -> ${current.version}`);
	}
	for (const feature of current.features) {
		const old = oldFeatures.get(feature.key);
		if (!old) {
			changes.push(`Added: ${feature.key} (${feature.stage})`);
		} else {
			if (old.stage !== feature.stage) {
				changes.push(`Stage: ${feature.key}: ${old.stage} -> ${feature.stage}`);
			}
			if (old.defaultEnabled !== feature.defaultEnabled) {
				changes.push(`Default: ${feature.key}: ${old.defaultEnabled} -> ${feature.defaultEnabled}`);
			}
		}
	}
	for (const key of oldFeatures.keys()) {
		if (!newFeatures.has(key)) {
			changes.push(`Deleted: ${key}`);
		}
	}
	return changes;
}
