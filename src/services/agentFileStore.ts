import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

/** Keep the previous file intact if writing or replacing its successor fails. */
export function writeAgentFile(filePath: string, contents: string): void {
	const targetPath = fs.existsSync(filePath) ? fs.realpathSync(filePath) : filePath;
	fs.mkdirSync(path.dirname(targetPath), { recursive: true });
	const mode = fs.existsSync(targetPath) ? fs.statSync(targetPath).mode : 0o600;
	const temporaryPath = `${targetPath}.${randomUUID()}.tmp`;
	try {
		fs.writeFileSync(temporaryPath, contents, { encoding: 'utf8', flag: 'wx', mode });
		fs.renameSync(temporaryPath, targetPath);
	} finally {
		if (fs.existsSync(temporaryPath)) { fs.unlinkSync(temporaryPath); }
	}
}
