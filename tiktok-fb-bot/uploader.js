const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');

const FB_GRAPH_API_VERSION = process.env.FB_GRAPH_API_VERSION || 'v20.0';
const FB_GRAPH_API_URL = `https://graph.facebook.com/${FB_GRAPH_API_VERSION}`;
const FB_POST_PUBLISHED = process.env.FB_POST_PUBLISHED !== 'false';
const CHUNK_MAX_RETRIES = 3;

function normalizeHashtag(tag) {
  const trimmed = String(tag || '').trim();
  if (!trimmed) {
    return '';
  }
  return trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
}

function buildDescription(tiktokDescription, tags = []) {
  const parts = [];

  if (typeof tiktokDescription === 'string' && tiktokDescription.trim()) {
    parts.push(tiktokDescription.trim());
  }

  const uniqueTags = [];
  for (const tag of tags) {
    const normalized = normalizeHashtag(tag);
    if (normalized && !uniqueTags.includes(normalized)) {
      uniqueTags.push(normalized);
    }
    if (uniqueTags.length >= 3) {
      break;
    }
  }

  if (uniqueTags.length > 0) {
    parts.push(uniqueTags.join(' '));
  }

  return parts.join('\n\n');
}

function readFileChunk(filePath, startOffset, endOffset) {
  const length = endOffset - startOffset;
  const buffer = Buffer.alloc(length);
  const fd = fs.openSync(filePath, 'r');

  try {
    const bytesRead = fs.readSync(fd, buffer, 0, length, startOffset);
    return buffer.subarray(0, bytesRead);
  } finally {
    fs.closeSync(fd);
  }
}

function mapFacebookError(error) {
  if (!error.response) {
    if (error.code === 'ECONNABORTED') {
      throw new Error('Upload timeout. Facebook took too long to respond.');
    }
    throw new Error(`Facebook upload failed: ${error.message || 'Unknown error'}`);
  }

  const errorMsg = error.response.data.error?.message || error.response.statusText;

  if (error.response.status === 401) {
    throw new Error(
      'Facebook authentication failed. Use a long-lived Page Access Token (not a user token) and confirm the Page ID is correct.'
    );
  }

  if (error.response.status === 403) {
    throw new Error(
      'Facebook permission denied. Recreate the Page Access Token with Pages API + publish_video permissions and use that token here.'
    );
  }

  if (error.response.status === 400) {
    throw new Error(`Facebook validation error: ${errorMsg}`);
  }

  throw new Error(`Facebook upload failed: ${errorMsg}`);
}

async function cancelUpload(pageId, accessToken, uploadSessionId) {
  try {
    await axios.post(`${FB_GRAPH_API_URL}/${pageId}/videos`, {
      upload_phase: 'cancel',
      upload_session_id: uploadSessionId,
      access_token: accessToken,
    });
    console.log('Cancelled Facebook upload session');
  } catch (error) {
    console.warn('Failed to cancel Facebook upload session:', error.message);
  }
}

async function startUpload(pageId, accessToken, fileSize) {
  const response = await axios.post(`${FB_GRAPH_API_URL}/${pageId}/videos`, {
    upload_phase: 'start',
    file_size: fileSize,
    access_token: accessToken,
  });

  const { upload_session_id: uploadSessionId, video_id: videoId, start_offset: startOffset, end_offset: endOffset } =
    response.data;

  if (!uploadSessionId) {
    throw new Error('Facebook did not return an upload session id');
  }

  return {
    uploadSessionId,
    videoId,
    startOffset: Number(startOffset),
    endOffset: Number(endOffset),
  };
}

async function transferChunk(pageId, accessToken, uploadSessionId, startOffset, chunk, attempt = 1) {
  try {
    const form = new FormData();
    form.append('access_token', accessToken);
    form.append('upload_phase', 'transfer');
    form.append('upload_session_id', uploadSessionId);
    form.append('start_offset', String(startOffset));
    form.append('video_file_chunk', chunk, {
      filename: 'chunk.bin',
      contentType: 'application/octet-stream',
    });

    const response = await axios.post(`${FB_GRAPH_API_URL}/${pageId}/videos`, form, {
      headers: form.getHeaders(),
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      timeout: 600000,
    });

    return {
      startOffset: Number(response.data.start_offset),
      endOffset: Number(response.data.end_offset),
    };
  } catch (error) {
    if (attempt < CHUNK_MAX_RETRIES) {
      console.warn(`Chunk transfer failed at offset ${startOffset}, retrying (${attempt}/${CHUNK_MAX_RETRIES})...`);
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
      return transferChunk(pageId, accessToken, uploadSessionId, startOffset, chunk, attempt + 1);
    }

    throw error;
  }
}

async function finishUpload(pageId, accessToken, uploadSessionId, metadata) {
  const form = new FormData();
  form.append('access_token', accessToken);
  form.append('upload_phase', 'finish');
  form.append('upload_session_id', uploadSessionId);
  form.append('published', String(metadata.published !== false));
  form.append('title', metadata.title);
  form.append('description', metadata.description);

  if (metadata.thumbnailPath && fs.existsSync(metadata.thumbnailPath)) {
    form.append('thumb', fs.createReadStream(metadata.thumbnailPath));
  } else if (metadata.thumbnailPath) {
    console.warn(`Thumbnail not found, uploading without custom thumb: ${metadata.thumbnailPath}`);
  }

  const response = await axios.post(`${FB_GRAPH_API_URL}/${pageId}/videos`, form, {
    headers: form.getHeaders(),
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
    timeout: 600000,
  });

  return response.data.id || response.data.video_id;
}

async function uploadChunks(pageId, accessToken, videoFilePath, fileSize, uploadSessionId, initialStartOffset, initialEndOffset) {
  let startOffset = initialStartOffset;
  let endOffset = initialEndOffset;
  let chunkIndex = 0;

  while (startOffset < fileSize) {
    const chunkEnd = Math.min(endOffset, fileSize);
    const chunk = readFileChunk(videoFilePath, startOffset, chunkEnd);
    chunkIndex += 1;
    console.log(`Uploading chunk ${chunkIndex}: bytes ${startOffset}-${chunkEnd - 1}`);

    const next = await transferChunk(pageId, accessToken, uploadSessionId, startOffset, chunk);
    startOffset = next.startOffset;
    endOffset = next.endOffset;
  }
}

/**
 * Upload video to Facebook Page via resumable Graph API
 * Returns the Facebook video ID on success
 */
async function uploadToFacebook(videoFilePath, pageId, accessToken, metadata = {}, tags = []) {
  let uploadSessionId = null;

  try {
    if (!fs.existsSync(videoFilePath)) {
      throw new Error(`Video file not found: ${videoFilePath}`);
    }

    const fileStats = fs.statSync(videoFilePath);
    const fileSize = fileStats.size;
    const fileSizeInMB = fileSize / (1024 * 1024);

    if (fileSizeInMB > 2048) {
      throw new Error(
        `Video file too large (${fileSizeInMB.toFixed(2)}MB). Facebook max is 2GB.`
      );
    }

    const title = (metadata.title || 'TikTok Video').trim();
    const description = buildDescription(metadata.description, tags);
    const published = metadata.published !== undefined ? metadata.published : FB_POST_PUBLISHED;

    console.log(`Uploading to Facebook via resumable API (${fileSizeInMB.toFixed(2)}MB)...`);
    console.log(`Title: ${title}`);

    const session = await startUpload(pageId, accessToken, fileSize);
    uploadSessionId = session.uploadSessionId;

    await uploadChunks(
      pageId,
      accessToken,
      videoFilePath,
      fileSize,
      uploadSessionId,
      session.startOffset,
      session.endOffset
    );

    const videoId = await finishUpload(pageId, accessToken, uploadSessionId, {
      title,
      description,
      thumbnailPath: metadata.thumbnailPath,
      published,
    });

    console.log(`Video uploaded successfully. Facebook Video ID: ${videoId || session.videoId}`);
    return videoId || session.videoId;
  } catch (error) {
    if (uploadSessionId) {
      await cancelUpload(pageId, accessToken, uploadSessionId);
    }
    mapFacebookError(error);
  }
}

module.exports = {
  uploadToFacebook,
  buildDescription,
};
