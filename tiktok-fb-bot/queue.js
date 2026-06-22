const fs = require('fs');
const path = require('path');

const QUEUE_FILE = path.join(__dirname, 'links.txt');

/**
 * Parse URL and tags from a line
 * Format: https://url.com/video #tag1 #tag2
 * Returns { url, tags }
 */
function parseUrlAndTags(line) {
  const parts = line.trim().split(/\s+/);
  const url = parts[0];
  const tags = parts.slice(1).filter((p) => p.startsWith('#'));
  return { url, tags };
}

/**
 * Read all lines from links.txt
 * Filter out blank lines and comments
 * Return next unprocessed URL with tags (not marked with #done)
 * Returns { url, tags } or null
 */
function getNextUrl() {
  try {
    if (!fs.existsSync(QUEUE_FILE)) {
      console.log('Queue file not found. Creating links.txt...');
      fs.writeFileSync(QUEUE_FILE, '# Add TikTok URLs here, one per line\n# Format: https://url.com/video #tag1 #tag2\n');
      return null;
    }

    const content = fs.readFileSync(QUEUE_FILE, 'utf-8');
    const lines = content.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();

      // Skip empty lines and comments
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }

      // Found an unprocessed line - parse it
      return parseUrlAndTags(trimmed);
    }

    // Queue is empty
    return null;
  } catch (error) {
    console.error('Error reading queue:', error);
    return null;
  }
}

/**
 * Mark a URL as done by prefixing it with #done
 */
function markAsDone(urlToMark) {
  try {
    const content = fs.readFileSync(QUEUE_FILE, 'utf-8');
    let lines = content.split('\n');

    // Find and replace the URL with #done version
    lines = lines.map((line) => {
      const trimmed = line.trim();
      // Check if this line starts with the URL (ignoring tags)
      if (trimmed.startsWith(urlToMark)) {
        return `#done ${line}`;
      }
      return line;
    });

    fs.writeFileSync(QUEUE_FILE, lines.join('\n'), 'utf-8');
    console.log(`Marked as done: ${urlToMark}`);
  } catch (error) {
    console.error('Error marking URL as done:', error);
  }
}

/**
 * Get all pending URLs (not yet processed)
 */
function getPendingUrls() {
  try {
    if (!fs.existsSync(QUEUE_FILE)) {
      return [];
    }

    const content = fs.readFileSync(QUEUE_FILE, 'utf-8');
    const lines = content.split('\n');

    return lines
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => parseUrlAndTags(line));
  } catch (error) {
    console.error('Error getting pending URLs:', error);
    return [];
  }
}

function appendLinks(input) {
  try {
    const rawLines = String(input || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => !line.startsWith('#'));

    if (rawLines.length === 0) {
      return { added: 0 };
    }

    if (!fs.existsSync(QUEUE_FILE)) {
      fs.writeFileSync(
        QUEUE_FILE,
        '# Add TikTok URLs here, one per line\n# Format: https://url.com/video #tag1 #tag2\n',
        'utf-8'
      );
    }

    const currentContent = fs.readFileSync(QUEUE_FILE, 'utf-8');
    const existingLines = currentContent
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'));

    const uniqueLines = rawLines.filter((line) => !existingLines.includes(line));

    if (uniqueLines.length === 0) {
      return { added: 0 };
    }

    const newContent = `${currentContent}${currentContent.endsWith('\n') ? '' : '\n'}${uniqueLines.join('\n')}\n`;
    fs.writeFileSync(QUEUE_FILE, newContent, 'utf-8');

    return { added: uniqueLines.length };
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
};
