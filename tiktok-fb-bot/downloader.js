const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const util = require('util');

const execPromise = util.promisify(exec);
const DOWNLOADS_DIR =
  process.env.DOWNLOADS_DIR ||
  (process.platform === 'win32'
    ? path.join(os.tmpdir(), 'tiktok-fb-bot-downloads')
    : path.join(__dirname, 'downloads'));
const MAX_DOWNLOAD_ATTEMPTS = 3;

function resolveYtDlpPath() {
  const candidates = [
    process.env.YT_DLP_PATH,
    'C:\\Users\\minaa\\AppData\\Local\\Python\\pythoncore-3.14-64\\Scripts\\yt-dlp.exe',
    'C:\\Users\\minaa\\AppData\\Local\\Programs\\Python\\Python314\\Scripts\\yt-dlp.exe',
    'C:\\Users\\minaa\\AppData\\Roaming\\Python\\Python314\\Scripts\\yt-dlp.exe',
    'yt-dlp',
    'yt-dlp.exe',
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return 'yt-dlp';
}

/**
 * Ensure downloads directory exists
 */
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

/**
 * Remove stale partial/final files for a video before retrying.
 */
function cleanupVideoArtifacts(videoId) {
  if (!videoId || !fs.existsSync(DOWNLOADS_DIR)) {
    return;
  }

  const removableExtensions = ['.part', '.mp4', '.jpg', '.jpeg', '.webp', '.info.json'];

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

  const candidates = ['.jpg', '.jpeg', '.webp', '.png'];
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

/**
 * Download TikTok video without watermark using yt-dlp
 * Returns metadata object on success
 * Throws error on failure
 */
async function downloadVideo(tiktokUrl, attempt = 1) {
  const videoId = extractVideoId(tiktokUrl);

  try {
    ensureDownloadsDir();
    cleanupVideoArtifacts(videoId);

    console.log(`Downloading TikTok video: ${tiktokUrl}`);
    if (attempt > 1) {
      console.log(`Download retry ${attempt}/${MAX_DOWNLOAD_ATTEMPTS}`);
    }

    const outputTemplate = path.join(DOWNLOADS_DIR, '%(id)s.%(ext)s');
    const ytDlpPath = resolveYtDlpPath();
    const impersonateTarget = process.env.YT_DLP_IMPERSONATE || 'Chrome-124';
    const windowsFlags =
      process.platform === 'win32' ? '--no-part --retries 5 --fragment-retries 5 ' : '';
    const command = `"${ytDlpPath}" ${windowsFlags}--impersonate "${impersonateTarget}" -f "download_addr-2/best" --write-info-json --write-thumbnail --convert-thumbnails jpg -o "${outputTemplate}" "${tiktokUrl}"`;

    const { stdout } = await execPromise(command, {
      timeout: 300000,
    });

    console.log('Download output:', stdout);

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

    if (isFileLockError(errorMsg) && attempt < MAX_DOWNLOAD_ATTEMPTS) {
      console.warn(`File lock during download, retrying in 2s (${attempt}/${MAX_DOWNLOAD_ATTEMPTS})...`);
      cleanupVideoArtifacts(videoId);
      await sleep(2000);
      return downloadVideo(tiktokUrl, attempt + 1);
    }

    if (errorMsg.includes('not found') || errorMsg.includes('Cannot find module') || errorMsg.includes('No such file or directory')) {
      throw new Error(
        'yt-dlp executable not found. Verify installation: pip install yt-dlp'
      );
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
