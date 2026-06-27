require('dotenv').config();
const fs = require('fs');
const { execFileSync } = require('child_process');

const p = process.env.YT_DLP_PATH;
console.log('YT_DLP_PATH=' + p);
if (p) {
	try {
		console.log('EXISTS=' + fs.existsSync(p));
	} catch (e) {
		console.log('EXISTS=undefined');
	}
}

const tryRun = (command, args) => {
	try {
		return execFileSync(command, args, { encoding: 'utf8' }).toString().trim();
	} catch (e) {
		return null;
	}
};

let version = null;
if (p && fs.existsSync(p)) {
	version = tryRun(p, ['--version']);
}

if (!version) {
	version = tryRun('yt-dlp', ['--version']);
}

if (!version) {
	// Try python -m yt_dlp
	const pythonCmds = ['python', 'python3'];
	for (const py of pythonCmds) {
		version = tryRun(py, ['-m', 'yt_dlp', '--version']);
		if (version) break;
	}
}

if (version) {
	console.log('VERSION=' + version);
} else {
	console.error('ERROR running yt-dlp: executable not found or failed to run');
	console.error('Hint: install yt-dlp (python -m pip install -U yt-dlp) or set YT_DLP_PATH in .env to the executable path.');
	process.exit(1);
}
