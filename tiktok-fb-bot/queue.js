const fs = require('fs');
const path = require('path');
const { getDefaultPageKey } = require('./pages');
const { createClient } = require('redis');

const QUEUE_FILE = path.join(__dirname, 'links.txt');

// Redis keys
const QUEUE_KEY = 'tiktok:queue';
const PROCESSING_KEY = 'tiktok:processing';
const PENDING_SET = 'tiktok:pending:set';
const DONE_LIST = 'tiktok:done';

let redisClient = null;
let redisAvailable = false;

async function initRedis() {
  if (redisClient) return;
  const url = process.env.REDIS_URL;
  if (!url) return;
  try {
    redisClient = createClient({ url });
    redisClient.on('error', (err) => console.warn('Redis error:', err && err.message ? err.message : err));
    await redisClient.connect();
    redisAvailable = true;
    console.log('Redis queue enabled');
  } catch (err) {
    console.warn('Could not connect to Redis, falling back to file queue:', err && err.message ? err.message : err);
    redisClient = null;
    redisAvailable = false;
  }
}

// helpers for parsing/building lines (same format as file-based queue)
function parseUrlAndTags(line) {
  const parts = line.trim().split(/\s+/);
  const url = parts[0];
  const tags = parts.slice(1).filter((part) => part.startsWith('#'));
  return { url, tags };
}

function parseQueueLine(line) {
  const trimmed = line.trim();
  let pageKey = getDefaultPageKey();
  let content = trimmed;

  const pageMatch = trimmed.match(/^@([a-zA-Z0-9_-]+)\s+(.+)$/);
  if (pageMatch) {
    pageKey = pageMatch[1];
    content = pageMatch[2];
  }

  const { url, tags } = parseUrlAndTags(content);
  return { url, tags, pageKey };
}

function normalizeTags(tagsInput) {
  return String(tagsInput || '')
    .split(/[\s,]+/)
    .map((tag) => tag.trim())
    .filter(Boolean)
    .map((tag) => (tag.startsWith('#') ? tag : `#${tag}`));
}

function buildQueueLine(url, tagsInput = '', pageKey) {
  const tags = normalizeTags(tagsInput);
  const tagSuffix = tags.length ? ` ${tags.join(' ')}` : '';
  const key = (pageKey || getDefaultPageKey()).trim();
  return `@${key} ${url}${tagSuffix}`;
}

// File-based fallback implementations (kept from original)
function file_isQueueLine(line) {
  const trimmed = line.trim();
  return Boolean(trimmed) && !trimmed.startsWith('#');
}

function file_getNextUrl() {
  try {
    if (!fs.existsSync(QUEUE_FILE)) {
      console.log('Queue file not found. Creating links.txt...');
      fs.writeFileSync(
        QUEUE_FILE,
        '# Add TikTok URLs here, one per line\n# Optional page prefix: @page2 https://url.com/video #tag1\n'
      );
      return null;
    }

    const content = fs.readFileSync(QUEUE_FILE, 'utf-8');
    const lines = content.split('\n');

    for (const line of lines) {
      if (!file_isQueueLine(line)) {
        continue;
      }

      return parseQueueLine(line);
    }

    return null;
  } catch (error) {
    console.error('Error reading queue:', error);
    return null;
  }
}

function file_markAsDone(urlToMark) {
  try {
    const content = fs.readFileSync(QUEUE_FILE, 'utf-8');
    const lines = content.split('\n');

    const updated = lines.map((line) => {
      const trimmed = line.trim();
      if (!file_isQueueLine(line)) {
        return line;
      }

      const parsed = parseQueueLine(trimmed);
      if (parsed.url === urlToMark || trimmed.includes(urlToMark)) {
        return `#done ${line}`;
      }

      return line;
    });

    fs.writeFileSync(QUEUE_FILE, updated.join('\n'), 'utf-8');
    console.log(`Marked as done: ${urlToMark}`);
  } catch (error) {
    console.error('Error marking URL as done:', error);
  }
}

function file_getPendingUrls() {
  try {
    if (!fs.existsSync(QUEUE_FILE)) {
      return [];
    }

    const content = fs.readFileSync(QUEUE_FILE, 'utf-8');
    return content
      .split('\n')
      .filter(file_isQueueLine)
      .map((line) => parseQueueLine(line.trim()));
  } catch (error) {
    console.error('Error getting pending URLs:', error);
    return [];
  }
}

function file_appendLinks(input, tagsInput = '', pageKey) {
  try {
    const selectedPageKey = (pageKey || getDefaultPageKey()).trim();
    const rawLines = String(input || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => !line.startsWith('#'))
      .map((line) => {
        const { url } = parseUrlAndTags(line);
        return buildQueueLine(url, tagsInput, selectedPageKey);
      });

    if (rawLines.length === 0) {
      return { added: 0 };
    }

    if (!fs.existsSync(QUEUE_FILE)) {
      fs.writeFileSync(
        QUEUE_FILE,
        '# Add TikTok URLs here, one per line\n# Optional page prefix: @page2 https://url.com/video #tag1\n',
        'utf-8'
      );
    }

    const currentContent = fs.readFileSync(QUEUE_FILE, 'utf-8');
    const existingLines = currentContent
      .split('\n')
      .map((line) => line.trim())
      .filter(file_isQueueLine);

    const uniqueLines = rawLines.filter((line) => !existingLines.includes(line));

    if (uniqueLines.length === 0) {
      return { added: 0 };
    }

    const newContent = `${currentContent}${currentContent.endsWith('\n') ? '' : '\n'}${uniqueLines.join('\n')}\n`;
    fs.writeFileSync(QUEUE_FILE, newContent, 'utf-8');

    return { added: uniqueLines.length, pageKey: selectedPageKey };
  } catch (error) {
    console.error('Error appending links:', error);
    return { added: 0, error: error.message };
  }
}

// Redis-backed implementations
async function redis_getNextUrl() {
  if (!redisAvailable) return null;
  try {
    // Atomically move oldest item from queue to processing (FIFO)
    const item = await redisClient.rPopLPush(QUEUE_KEY, PROCESSING_KEY);
    if (!item) return null;
    // remove from pending set (we treat set as de-dupe)
    try { await redisClient.sRem(PENDING_SET, item); } catch (e) {}
    return parseQueueLine(item);
  } catch (err) {
    console.warn('Redis getNextUrl failed:', err && err.message ? err.message : err);
    return null;
  }
}

async function redis_markAsDone(urlToMark) {
  if (!redisAvailable) return file_markAsDone(urlToMark);
  try {
    // scan processing list for matching items
    const items = await redisClient.lRange(PROCESSING_KEY, 0, -1);
    for (const line of items) {
      const parsed = parseQueueLine(line);
      if (parsed.url === urlToMark || line.includes(urlToMark)) {
        // remove this exact list item
        await redisClient.lRem(PROCESSING_KEY, 0, line);
        await redisClient.sRem(PENDING_SET, line);
        await redisClient.lPush(DONE_LIST, line);
        console.log(`Marked as done (redis): ${urlToMark}`);
      }
    }
  } catch (err) {
    console.error('Error marking URL as done (redis):', err && err.message ? err.message : err);
  }
}

async function redis_getPendingUrls() {
  if (!redisAvailable) return file_getPendingUrls();
  try {
    const queueItems = await redisClient.lRange(QUEUE_KEY, 0, -1);
    const processing = await redisClient.lRange(PROCESSING_KEY, 0, -1);
    const combined = [...queueItems.reverse(), ...processing.reverse()];
    return combined.map((line) => parseQueueLine(line));
  } catch (err) {
    console.warn('Redis getPendingUrls failed:', err && err.message ? err.message : err);
    return [];
  }
}

async function redis_appendLinks(input, tagsInput = '', pageKey) {
  if (!redisAvailable) return file_appendLinks(input, tagsInput, pageKey);
  try {
    const selectedPageKey = (pageKey || getDefaultPageKey()).trim();
    const rawLines = String(input || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => !line.startsWith('#'))
      .map((line) => {
        const { url } = parseUrlAndTags(line);
        return buildQueueLine(url, tagsInput, selectedPageKey);
      });

    if (rawLines.length === 0) {
      return { added: 0 };
    }

    // Use pipeline to add unique items
    const pipeline = redisClient.multi();
    let added = 0;
    for (const line of rawLines) {
      pipeline.sAdd(PENDING_SET, line);
    }
    const saddResults = await pipeline.exec();
    // saddResults is an array of responses; we need to push items that were newly added
    // But redis multi/exec returns array of arrays in node-redis v4 - handle simply by re-checking
    for (const line of rawLines) {
      const wasMember = await redisClient.sIsMember(PENDING_SET, line);
      if (!wasMember) {
        // if not member, add and push
        await redisClient.sAdd(PENDING_SET, line);
        await redisClient.lPush(QUEUE_KEY, line);
        added += 1;
      }
    }

    return { added, pageKey: selectedPageKey };
  } catch (err) {
    console.error('Redis appendLinks failed:', err && err.message ? err.message : err);
    return { added: 0, error: err.message };
  }
}

// Public wrapper API
async function getNextUrl() {
  if (!redisClient) {
    await initRedis();
  }
  if (redisAvailable) return redis_getNextUrl();
  return file_getNextUrl();
}

async function markAsDone(urlToMark) {
  if (!redisClient) {
    await initRedis();
  }
  if (redisAvailable) return redis_markAsDone(urlToMark);
  return file_markAsDone(urlToMark);
}

async function getPendingUrls() {
  if (!redisClient) {
    await initRedis();
  }
  if (redisAvailable) return redis_getPendingUrls();
  return file_getPendingUrls();
}

async function appendLinks(input, tagsInput = '', pageKey) {
  if (!redisClient) {
    await initRedis();
  }
  if (redisAvailable) return redis_appendLinks(input, tagsInput, pageKey);
  return file_appendLinks(input, tagsInput, pageKey);
}

module.exports = {
  getNextUrl,
  markAsDone,
  getPendingUrls,
  appendLinks,
  parseQueueLine,
  buildQueueLine,
};
