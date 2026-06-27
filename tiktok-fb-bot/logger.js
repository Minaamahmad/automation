const fs = require('fs');
const path = require('path');

const LOGS_FILE = path.join(__dirname, 'logs.txt');

/**
 * Format current timestamp for logs
 */
function getTimestamp() {
  return new Date().toISOString().replace('T', ' ').split('.')[0];
}

/**
 * Log a successful upload
 */
function logSuccess(tiktokUrl, fbVideoId, pageName = null) {
  const timestamp = getTimestamp();
  const pagePart = pageName ? ` | Page: ${pageName}` : '';
  const entry = `[${timestamp}] SUCCESS | ${tiktokUrl}${pagePart} | FB Video ID: ${fbVideoId}\n`;

  try {
    fs.appendFileSync(LOGS_FILE, entry, 'utf-8');
    console.log('✓ Logged success:', entry.trim());
  } catch (error) {
    console.error('Error writing to logs:', error);
  }
}

/**
 * Log a failed upload
 */
function logFailure(tiktokUrl, reason) {
  const timestamp = getTimestamp();
  const entry = `[${timestamp}] FAILED  | ${tiktokUrl} | Reason: ${reason}\n`;

  try {
    fs.appendFileSync(LOGS_FILE, entry, 'utf-8');
    console.log('✗ Logged failure:', entry.trim());
  } catch (error) {
    console.error('Error writing to logs:', error);
  }
}

/**
 * Log general info message
 */
function logInfo(message) {
  const timestamp = getTimestamp();
  const entry = `[${timestamp}] INFO    | ${message}\n`;

  try {
    fs.appendFileSync(LOGS_FILE, entry, 'utf-8');
    console.log('ℹ', entry.trim());
  } catch (error) {
    console.error('Error writing to logs:', error);
  }
}

/**
 * Get all log entries
 */
function getLogs() {
  try {
    if (!fs.existsSync(LOGS_FILE)) {
      return [];
    }

    const content = fs.readFileSync(LOGS_FILE, 'utf-8');
    return content.split('\n').filter((line) => line.trim());
  } catch (error) {
    console.error('Error reading logs:', error);
    return [];
  }
}

function parseLogLine(line) {
  const match = line.match(/^\[([^\]]+)\]\s+(SUCCESS|FAILED|INFO)\s+\|\s+(.+)$/);
  if (!match) {
    return { time: null, type: 'info', url: null, message: line };
  }

  const [, time, type, rest] = match;
  const normalizedType = type.toLowerCase();

  if (normalizedType === 'success') {
    const parts = rest.match(/^(.+?)(?:\s+\|\s+Page:\s+([^|]+?))?\s+\|\s+FB Video ID:\s*(.+)$/);
    const pageName = parts?.[2]?.trim();
    const fbId = parts?.[3]?.trim();
    return {
      time,
      type: 'success',
      url: parts?.[1]?.trim() || null,
      message: pageName
        ? `Posted to ${pageName} · FB ID ${fbId}`
        : fbId
          ? `Posted · FB ID ${fbId}`
          : rest,
    };
  }

  if (normalizedType === 'failed') {
    const parts = rest.match(/^(.+?)\s+\|\s+Reason:\s*(.+)$/s);
    return {
      time,
      type: 'failed',
      url: parts?.[1]?.trim() || null,
      message: parts?.[2]?.trim() || rest,
    };
  }

  return { time, type: 'info', url: null, message: rest.trim() };
}

function getStructuredLogs(limit = 20) {
  return getLogs()
    .slice(-limit)
    .reverse()
    .map(parseLogLine);
}

module.exports = {
  logSuccess,
  logFailure,
  logInfo,
  getLogs,
  parseLogLine,
  getStructuredLogs,
};
