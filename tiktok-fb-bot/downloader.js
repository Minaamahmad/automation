const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const util = require('util');

const execFilePromise = util.promisify(execFile);
const DOWNLOADS_DIR =
  process.env.DOWNLOADS_DIR ||
  (process.platform === 'win32'
    ? path.join(os.tmpdir(), 'tiktok-fb-bot-downloads')
    : path.join(__dirname, 'downloads'));
const MAX_DOWNLOAD_ATTEMPTS = 3;

function resolveYtDlpPath() {
  const candidates = [process.env.YT_DLP_PATH];

  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      if (!fs.existsSync(candidate)) continue;
      const stat = fs.statSync(candidate);
      if (stat.isFile()) return candidate;
    } catch (e) {
      // ignore and try next
    }
  }

  return 'yt-dlp';
}

function normalizeImpersonateTarget(target) {
  const trimmed = String(target || '').trim();
  if (!trimmed) return null;

  if (/^(Chrome|Edge|Firefox|Safari|Tor)-/i.test(trimmed)) {
    return trimmed;
  }

  // Common typo: "131:Android-14" → "Chrome-131:Android-14"
  if (/^\d+:/.test(trimmed)) {
    return `Chrome-${trimmed}`;
  }

  console.warn(`Ignoring invalid YT_DLP_IMPERSONATE value: ${trimmed}`);
  return null;
}

function getImpersonateTargets() {
  const defaults =
    process.platform === 'win32'
      ? ['Chrome-146:Macos-26', 'Chrome-131:Android-14', 'Edge-101']
      : ['Chrome-146:Macos-26', 'Chrome-131:Android-14', 'Chrome-133:Macos-15'];

  const envTarget = normalizeImpersonateTarget(process.env.YT_DLP_IMPERSONATE);
  if (envTarget) {
    return [
      envTarget,
      ...defaults.filter((target) => target.toLowerCase() !== envTarget.toLowerCase()),
    ];
  }

  return defaults;
}

function ensureDownloadsDir() {
  if (!fs.existsSync(DOWNLOADS_DIR)) {
    fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
  }
}

function extractVideoId(tiktokUrl) {
  const match = String(tiktokUrl).match(/\/video\/(\d+)/);
  return match ? match[1] : null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanupVideoArtifacts(videoId) {
  if (!videoId || !fs.existsSync(DOWNLOADS_DIR)) {
    return;
  }

  const removableExtensions = ['.part', '.mp4', '.jpg', '.jpeg', '.webp', '.image', '.info.json'];

  for (const file of fs.readdirSync(DOWNLOADS_DIR)) {
    if (!file.startsWith(videoId)) {
      continue;
    }

    const shouldRemove = removableExtensions.some(
      (ext) => file.endsWith(ext) || file === `${videoId}.mp4`
    );

    if (shouldRemove) {
      const filePath = path.join(DOWNLOADS_DIR, file);
      try {
        fs.unlinkSync(filePath);
        console.log(`Cleaned up stale file: ${filePath}`);
      } catch (cleanupError) {
        console.warn(`Could not remove stale file ${filePath}: ${cleanupError.message}`);
      }
    }
  }
}

function findDownloadedFile(videoId) {
  if (videoId) {
    const expectedPath = path.join(DOWNLOADS_DIR, `${videoId}.mp4`);
    if (fs.existsSync(expectedPath)) {
      return expectedPath;
    }
  }

  const files = fs
    .readdirSync(DOWNLOADS_DIR)
    .filter((file) => file.endsWith('.mp4') && !file.endsWith('.part'));

  if (files.length === 0) {
    return null;
  }

  let latestFile = files[0];
  let latestTime = fs.statSync(path.join(DOWNLOADS_DIR, files[0])).mtimeMs;

  for (let i = 1; i < files.length; i++) {
    const fileTime = fs.statSync(path.join(DOWNLOADS_DIR, files[i])).mtimeMs;
    if (fileTime > latestTime) {
      latestTime = fileTime;
      latestFile = files[i];
    }
  }

  return path.join(DOWNLOADS_DIR, latestFile);
}

function findThumbnailPath(videoId) {
  if (!videoId || !fs.existsSync(DOWNLOADS_DIR)) {
    return null;
  }

  const candidates = ['.jpg', '.jpeg', '.webp', '.png', '.image'];
  for (const ext of candidates) {
    const thumbPath = path.join(DOWNLOADS_DIR, `${videoId}${ext}`);
    if (fs.existsSync(thumbPath)) {
      return thumbPath;
    }
  }

  return null;
}

function readInfoJson(videoId) {
  if (!videoId) {
    return null;
  }

  const infoPath = path.join(DOWNLOADS_DIR, `${videoId}.info.json`);
  if (!fs.existsSync(infoPath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(infoPath, 'utf-8'));
  } catch (error) {
    console.warn(`Could not parse info json for ${videoId}: ${error.message}`);
    return null;
  }
}

function buildDownloadResult(videoId, videoPath) {
  const info = readInfoJson(videoId);
  const title = (info?.title || info?.fulltitle || '').trim();
  const description = (info?.description || '').trim();
  const thumbnailPath = findThumbnailPath(videoId);
  const infoJsonPath = videoId
    ? path.join(DOWNLOADS_DIR, `${videoId}.info.json`)
    : null;

  return {
    videoPath,
    videoId,
    title: title || (videoId ? `Video ${videoId}` : 'TikTok Video'),
    description,
    thumbnailPath: thumbnailPath || null,
    infoJsonPath: infoJsonPath && fs.existsSync(infoJsonPath) ? infoJsonPath : null,
  };
}

function isFileLockError(errorMsg) {
  return (
    errorMsg.includes('WinError 32') ||
    errorMsg.includes('being used by another process') ||
    errorMsg.includes('Unable to rename file')
  );
}

function isImpersonateError(errorMsg) {
  return (
    errorMsg.includes('Impersonate target') &&
    errorMsg.includes('not available')
  );
}

function isExtractorError(errorMsg) {
  return (
    errorMsg.includes('Unable to extract') ||
    errorMsg.includes('ExtractorError') ||
    errorMsg.includes('Unexpected response')
  );
}

function buildYtDlpCommand(ytDlpPath, args) {
  let execCmd = ytDlpPath;
  let finalArgs = args;

  try {
    const stat = fs.existsSync(ytDlpPath) && fs.statSync(ytDlpPath);
    const usePythonModule =
      !stat || !stat.isFile() || ytDlpPath === 'yt-dlp' || ytDlpPath === 'yt-dlp.exe';

    if (usePythonModule) {
      execCmd = process.env.PYTHON_EXEC || 'python';
      finalArgs = ['-m', 'yt_dlp', ...args];
    }
  } catch (e) {
    execCmd = process.env.PYTHON_EXEC || 'python';
    finalArgs = ['-m', 'yt_dlp', ...args];
  }

  return { execCmd, args: finalArgs };
}

function buildYtDlpArgs(tiktokUrl, impersonateTarget) {
  const outputTemplate = path.join(DOWNLOADS_DIR, '%(id)s.%(ext)s');
  const args = [];

  if (process.platform === 'win32') {
    args.push('--no-part', '--retries', '5', '--fragment-retries', '5');
  }

  args.push('--impersonate', impersonateTarget);
  args.push('--write-info-json', '--write-thumbnail');
  args.push('-o', outputTemplate);
  args.push(tiktokUrl);

  return args;
}

/**
 * Download TikTok video without watermark using yt-dlp
 * Returns metadata object on success
 * Throws error on failure
 */
async function downloadVideo(tiktokUrl, attempt = 1) {
  const videoId = extractVideoId(tiktokUrl);
  const impersonateTargets = getImpersonateTargets();
  const impersonateTarget = impersonateTargets[(attempt - 1) % impersonateTargets.length];

  try {
    ensureDownloadsDir();
    cleanupVideoArtifacts(videoId);

    console.log(`Downloading TikTok video: ${tiktokUrl}`);
    if (attempt > 1) {
      console.log(`Download retry ${attempt}/${MAX_DOWNLOAD_ATTEMPTS}`);
    }
    console.log(`Using yt-dlp impersonate target: ${impersonateTarget}`);

    const ytDlpPath = resolveYtDlpPath();
    const args = buildYtDlpArgs(tiktokUrl, impersonateTarget);
    const { execCmd, args: finalArgs } = buildYtDlpCommand(ytDlpPath, args);

    const { stdout, stderr } = await execFilePromise(execCmd, finalArgs, {
      cwd: DOWNLOADS_DIR,
      timeout: 300000,
      encoding: 'utf8',
    });

    if (stdout) console.log('Download stdout:', stdout);
    if (stderr) console.log('Download stderr:', stderr);

    const downloadedPath = findDownloadedFile(videoId);
    if (!downloadedPath) {
      throw new Error('yt-dlp completed but no file was downloaded');
    }

    const result = buildDownloadResult(videoId || path.basename(downloadedPath, '.mp4'), downloadedPath);
    console.log(`Video downloaded successfully: ${result.videoPath}`);
    if (result.title) {
      console.log(`Title: ${result.title}`);
    }
    if (result.thumbnailPath) {
      console.log(`Thumbnail: ${result.thumbnailPath}`);
    }

    return result;
  } catch (error) {
    const errorMsg = error.stderr || error.message || String(error);

    if (
      (isFileLockError(errorMsg) ||
        isExtractorError(errorMsg) ||
        isImpersonateError(errorMsg)) &&
      attempt < MAX_DOWNLOAD_ATTEMPTS
    ) {
      const reason = isFileLockError(errorMsg)
        ? 'file lock'
        : isImpersonateError(errorMsg)
          ? 'impersonate target error'
          : 'extractor error';
      console.warn(`${reason} during download, retrying in 2s (${attempt}/${MAX_DOWNLOAD_ATTEMPTS})...`);
      cleanupVideoArtifacts(videoId);
      await sleep(2000);
      return downloadVideo(tiktokUrl, attempt + 1);
    }

    if (
      errorMsg.includes('not found') ||
      errorMsg.includes('Cannot find module') ||
      errorMsg.includes('No such file or directory')
    ) {
      throw new Error('yt-dlp executable not found. Verify installation: pip install yt-dlp');
    }

    if (errorMsg.includes('Private video') || errorMsg.includes('Not available')) {
      throw new Error('Video is private or not available');
    }

    if (errorMsg.includes('deleted')) {
      throw new Error('Video has been deleted');
    }

    throw new Error(`Download failed: ${errorMsg}`);
  }
}

/**
 * Delete downloaded artifacts (video, thumbnail, info json)
 */
function deleteArtifacts(artifacts) {
  if (!artifacts) {
    return;
  }

  const paths = [
    artifacts.videoPath,
    artifacts.thumbnailPath,
    artifacts.infoJsonPath,
  ].filter(Boolean);

  for (const filePath of paths) {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log(`Deleted temp file: ${filePath}`);
      }
    } catch (error) {
      console.error(`Failed to delete file ${filePath}:`, error);
    }
  }
}

/** @deprecated Use deleteArtifacts */
function deleteVideo(filePath) {
  deleteArtifacts({ videoPath: filePath });
}

module.exports = {
  downloadVideo,
  deleteArtifacts,
  deleteVideo,
};
