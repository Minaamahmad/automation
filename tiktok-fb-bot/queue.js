const fs = require('fs');
const path = require('path');
const { getDefaultPageKey } = require('./pages');

const QUEUE_FILE = path.join(__dirname, 'links.txt');

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

function isQueueLine(line) {
  const trimmed = line.trim();
  return Boolean(trimmed) && !trimmed.startsWith('#');
}

function getNextUrl() {
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
      if (!isQueueLine(line)) {
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

function markAsDone(urlToMark) {
  try {
    const content = fs.readFileSync(QUEUE_FILE, 'utf-8');
    const lines = content.split('\n');

    const updated = lines.map((line) => {
      const trimmed = line.trim();
      if (!isQueueLine(line)) {
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

function getPendingUrls() {
  try {
    if (!fs.existsSync(QUEUE_FILE)) {
      return [];
    }

    const content = fs.readFileSync(QUEUE_FILE, 'utf-8');
    return content
      .split('\n')
      .filter(isQueueLine)
      .map((line) => parseQueueLine(line.trim()));
  } catch (error) {
    console.error('Error getting pending URLs:', error);
    return [];
  }
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

function appendLinks(input, tagsInput = '', pageKey) {
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
      .filter(isQueueLine);

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

module.exports = {
  getNextUrl,
  markAsDone,
  getPendingUrls,
  appendLinks,
  parseQueueLine,
  buildQueueLine,
};
