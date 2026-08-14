const test = require('node:test');
const assert = require('node:assert/strict');
const { buildYtDlpCommand } = require('./downloader');

test('buildYtDlpCommand falls back from a missing PYTHON_EXEC path', () => {
  process.env.PYTHON_EXEC = 'C:/definitely/missing/python.exe';
  const { execCmd } = buildYtDlpCommand('yt-dlp', ['https://example.com']);

  assert.notEqual(execCmd, process.env.PYTHON_EXEC);
  assert.ok(['python', 'python3', 'py'].includes(execCmd));
});
