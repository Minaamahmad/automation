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
function logSuccess(tiktokUrl, fbVideoId) {
  const timestamp = getTimestamp();
  const entry = `[${timestamp}] SUCCESS | ${tiktokUrl} | FB Video ID: ${fbVideoId}\n`;

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

module.exports = {
  logSuccess,
  logFailure,
  logInfo,
  getLogs,
};
