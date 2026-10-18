// Offline contract probe: no credentials, external provider, or agent execution.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

// Release all worker-owned Windows handles before removing its isolated fixtures.
if (!process.argv[3]) {
	const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-cli-contract-'));
	const result = spawnSync(process.execPath, [__filename, process.argv[2] ?? '', fixtureRoot], { stdio: 'inherit', timeout: 60000 });
	function removeOwnedFixtures(directory) {
		assert.ok(directory === fixtureRoot || directory.startsWith(`${fixtureRoot}${path.sep}`));
		for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
			const file = path.join(directory, entry.name);
			if (entry.isDirectory() && !entry.isSymbolicLink()) { removeOwnedFixtures(file); }
			else { fs.unlinkSync(file); }
		}
		for (let attempt = 0; ; attempt++) {
			try { fs.rmdirSync(directory); break; }
			catch (error) {
				if (!['EBUSY', 'EPERM'].includes(error.code) || attempt >= 120) { throw error; }
				Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
			}
		}
	}
	removeOwnedFixtures(fixtureRoot);
	process.exit(result.status ?? 1);
}
const Module = require('node:module');

// Filesystem service integration only; no VS Code UI is involved in these probes.
const originalLoad = Module._load;
let listCliAgentRecords;
let setCliAgentEnabled;
try {
	Module._load = function (request, ...args) {
		return request === 'vscode' ? { env: { language: 'en' }, workspace: {} } : originalLoad.call(this, request, ...args);
	};
	({ listCliAgentRecords, setCliAgentEnabled } = require('../out/services/cliAgentService'));
} finally { Module._load = originalLoad; }

const executable = process.argv[2];
assert.ok(executable, 'Pass the absolute path to the Codex CLI executable.');
assert.equal(spawnSync(executable, ['--version'], { encoding: 'utf8' }).stdout.trim(), 'codex-cli 0.163.0');
const root = process.argv[3];
const home = path.join(root, 'home');
const project = path.join(root, 'project');
const cwd = project;
fs.mkdirSync(cwd, { recursive: true });
fs.mkdirSync(home);
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(CODEX|ORCA|OPENAI)/.test(key)));
env.CODEX_HOME = home;
const definition = (name) => `name = "${name}"\ndescription = "Contract ${name}"\ndeveloper_instructions = "Inspect only."\n`;
const configPath = path.join(home, 'config.toml');
const locations = [{ kind: 'workspace', label: 'Home', rootPath: path.join(home, 'agents'), priority: 2 },
	{ kind: 'project', label: 'Project', rootPath: path.join(project, '.codex', 'agents'), priority: 1 }];
function write(relative, text) {
	const file = path.join(root, relative);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, text);
}

async function capture() {
	let request;
	const server = http.createServer((req, res) => {
		let body = '';
		req.on('data', (chunk) => { body += chunk; });
		req.on('end', () => { request = JSON.parse(body); res.writeHead(400); res.end('{}'); });
	});
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
	write('home/config.toml', `project_root_markers = [".probe-root"]\nmodel = "probe-model"\nmodel_provider = "probe"\n[model_providers.probe]\nname = "Probe"\nbase_url = "http://127.0.0.1:${server.address().port}/v1"\nwire_api = "responses"\nrequires_openai_auth = false\nrequest_max_retries = 0\n[projects.${JSON.stringify(project)}]\ntrust_level = "trusted"\n[agents]\nenabled = true\n${capture.declarations ?? ''}\n[features]\ncode_mode = false\n`);
	try {
		const child = spawn(executable, ['exec', '--skip-git-repo-check', 'Contract probe'], { cwd, env, stdio: ['pipe', 'ignore', 'pipe'] });
		child.stdin.end();
		let stderr = '';
		child.stderr.on('data', (chunk) => { stderr += chunk; });
		const timeout = setTimeout(() => child.kill(), 15000);
		try {
			await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
			child.stderr.destroy();
		} finally { clearTimeout(timeout); }
		assert.ok(request, `CLI did not reach the local provider: ${stderr}`);
		// The spawn tool description is the CLI's model-visible role catalog.
		const tools = JSON.stringify(request.tools);
		if (process.env.AGENT_PROBE_VERBOSE) { console.log(stderr, tools.match(/.{0,80}Available roles.{0,1600}/g)); }
		return [...tools.matchAll(/contract_[a-z_]+/g)].filter((value, index, values) => values.findIndex((item) => item[0] === value[0]) === index).map((value) => value[0]).sort();
	} finally { await new Promise((resolve) => server.close(resolve)); }
}

async function main() {
	write('project/.probe-root', '');
	write('project/.codex/config.toml', '# Trusted project layer\n');
	write('home/agents/unrelated-file.toml', definition('contract_home'));
	write('project/.codex/agents/project.toml', definition('contract_project'));
	write('project/.agents/agents/legacy.toml', definition('contract_legacy'));
	write('home/agents/subdir/nested.toml', definition('contract_nested'));
	write('home/agents/off.toml.disabled', definition('contract_disabled'));
	write('home/agents/flag.toml', `${definition('contract_flag')}enabled = false\n`);
	const expected = ['contract_home', 'contract_nested', 'contract_project'];
	const verify = async (label, names = expected) => {
		const found = await capture();
		assert.deepEqual(found, names, label);
		console.log(`${label}: PASS ${found.join(', ')}`);
	};
	await verify('discovery');
	assert.deepEqual(listCliAgentRecords(configPath, locations).filter((item) => item.enabled).map((item) => item.name).sort(), expected);
	for (const field of ['name', 'description', 'developer_instructions']) {
		write('home/agents/missing.toml', definition('contract_missing').split('\n').filter((line) => !line.startsWith(`${field} =`)).join('\n'));
		await verify(`missing ${field}`);
	}
	fs.unlinkSync(path.join(home, 'agents/missing.toml'));
	const record = listCliAgentRecords(configPath, locations).find((item) => item.name === 'contract_home');
	assert.deepEqual(setCliAgentEnabled(configPath, record.id, false, locations), { supported: true, changed: true });
	await verify('service OFF, fresh CLI session', ['contract_nested', 'contract_project']);
	assert.equal(listCliAgentRecords(configPath, locations).find((item) => item.id === record.id).enabled, false);
	assert.deepEqual(setCliAgentEnabled(configPath, record.id, true, locations), { supported: true, changed: true });
	await verify('service ON, fresh CLI session');
	capture.declarations = '[agents.contract_declared]\ndescription = "Declared role"\nconfig_file = "agents/unrelated-file.toml"\n';
	await verify('declaration plus standalone: body name overrides declaration key');
	const declared = listCliAgentRecords(configPath, locations).find((item) => item.name === 'contract_home');
	assert.equal(declared.roleKey, 'contract_declared');
	assert.equal(setCliAgentEnabled(configPath, declared.id, false, locations).supported, false);
	capture.declarations = '';
	await verify('declaration removed: standalone remains available');
	write('home/declared-role.toml', 'developer_instructions = "Inspect only."\n');
	capture.declarations = '[agents.contract_declared]\ndescription = "Legacy declaration"\nconfig_file = "declared-role.toml"\n';
	await verify('legacy reference declaration', ['contract_declared', ...expected]);
	const legacy = listCliAgentRecords(configPath, locations).find((item) => item.roleKey === 'contract_declared');
	assert.deepEqual(setCliAgentEnabled(configPath, legacy.id, false, locations), { supported: true, changed: true });
	// capture rewrites transport configuration; retain the service's resulting declaration state.
	capture.declarations = '';
	await verify('legacy declaration OFF, fresh CLI session');
	assert.deepEqual(setCliAgentEnabled(configPath, legacy.id, true, locations), { supported: true, changed: true });
	capture.declarations = fs.readFileSync(configPath, 'utf8').match(/\[agents\.contract_declared\][\s\S]*$/)[0];
	await verify('legacy declaration ON, fresh CLI session', ['contract_declared', ...expected]);
}
main().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1); });
