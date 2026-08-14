const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

test('appendLinks adds new URLs to the file queue', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tiktok-queue-test-'));
  const queueFile = path.join(tempDir, 'links.txt');
  process.env.QUEUE_FILE = queueFile;
  delete require.cache[require.resolve('./queue')];
  delete require.cache[require.resolve('./pages')];

  const queue = require('./queue');
  const result = queue.appendLinks(
    'https://www.tiktok.com/@user/video/1\nhttps://www.tiktok.com/@user/video/2',
    '#tag1',
    'default'
  );

  assert.equal(result.added, 2);
  const pending = queue.getPendingUrls();
  assert.equal(pending.length, 2);
  assert.equal(pending[0].url, 'https://www.tiktok.com/@user/video/1');

  fs.rmSync(tempDir, { recursive: true, force: true });
  delete process.env.QUEUE_FILE;
});
