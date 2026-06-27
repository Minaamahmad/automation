require('dotenv').config();
const cron = require('node-cron');
const queue = require('./queue');
const { downloadVideo, deleteArtifacts } = require('./downloader');
const { uploadToFacebook } = require('./uploader');
const logger = require('./logger');
const status = require('./status');
const { getPage, validatePages, getPageSummaries } = require('./pages');

const CRON_SCHEDULE = process.env.CRON_SCHEDULE || '0 * * * *';

function validateEnvironment() {
  console.log('\n=== TikTok → Facebook Bot Starting ===\n');

  let pages;
  try {
    pages = validatePages();
  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    process.exit(1);
  }

  console.log('✓ Environment validated');
  for (const page of pages) {
    console.log(`✓ Facebook Page [${page.key}]: ${page.name} (${page.id})`);
  }
  console.log(`✓ Cron Schedule: ${CRON_SCHEDULE}`);
  console.log('✓ Bot ready\n');

  logger.logInfo(`Bot started with ${pages.length} Facebook page(s)`);
}

/**
 * Main processing function - runs on each cron tick
 */
async function processQueue() {
  if (status.isProcessing()) {
    console.log('Already processing a video, skipping this tick.');
    return;
  }

  console.log('\n--- Cron tick started ---');

  try {
    const item = queue.getNextUrl();

    if (!item) {
      console.log('Queue is empty. Nothing to process.');
      logger.logInfo('Queue empty, skipping');
      return;
    }

    const tiktokUrl = item.url;
    const tags = item.tags || [];
    const pageKey = item.pageKey || 'default';
    const page = getPage(pageKey);

    console.log(`Processing: ${tiktokUrl}`);
    console.log(`Target page: ${page.name} [${page.key}]`);
    if (tags.length > 0) {
      console.log(`Tags: ${tags.join(' ')}`);
    }

    status.beginJob(tiktokUrl, tags, page.name);
    let downloadResult = null;

    try {
      console.log('Step 1/4: Downloading video...');
      status.setPhase('downloading', 'Downloading video from TikTok…');
      downloadResult = await downloadVideo(tiktokUrl);

      console.log('Step 2/4: Uploading to Facebook...');
      status.setPhase('uploading', `Uploading to ${page.name}…`);
      const fbVideoId = await uploadToFacebook(
        downloadResult.videoPath,
        page.id,
        page.token,
        {
          title: downloadResult.title,
          description: downloadResult.description,
          thumbnailPath: downloadResult.thumbnailPath,
        },
        tags
      );

      console.log('Step 3/4: Cleaning up downloaded files...');
      status.setPhase('cleaning', 'Removing temporary files…');
      deleteArtifacts(downloadResult);
      downloadResult = null;

      console.log('Step 4/4: Logging success...');
      logger.logSuccess(tiktokUrl, fbVideoId, page.name);
      queue.markAsDone(tiktokUrl);

      status.finishJob({
        type: 'success',
        url: tiktokUrl,
        message: `Posted to ${page.name} · ID ${fbVideoId}`,
      });

      console.log('✓ Processing completed successfully\n');
    } catch (error) {
      const errorMsg = error.message || String(error);
      console.error(`✗ Processing failed: ${errorMsg}`);
      logger.logFailure(tiktokUrl, errorMsg);
      queue.markAsDone(tiktokUrl, 'failed');

      if (downloadResult) {
        deleteArtifacts(downloadResult);
      }

      status.finishJob({
        type: 'failed',
        url: tiktokUrl,
        message: errorMsg,
      });
    }
  } catch (error) {
    console.error('Unexpected error in processQueue:', error);
    logger.logInfo(`Unexpected error: ${error.message}`);
    status.abortJob();
  }
}

/**
 * Start the cron scheduler
 */
function startScheduler() {
  console.log(`Starting cron scheduler: ${CRON_SCHEDULE}`);

  // Validate cron expression
  try {
    const task = cron.schedule(CRON_SCHEDULE, processQueue, {
      scheduled: false, // We'll start it manually
    });

    // Start immediately for first run, then follow schedule
    console.log('Running first check immediately...\n');
    processQueue();

    task.start();
    console.log('Scheduler is now running. Press Ctrl+C to stop.\n');
  } catch (error) {
    console.error('Invalid cron schedule:', CRON_SCHEDULE);
    console.error('Error:', error.message);
    process.exit(1);
  }
}

/**
 * Handle graceful shutdown
 */
process.on('SIGINT', () => {
  console.log('\n\nShutting down gracefully...');
  logger.logInfo('Bot stopped');
  process.exit(0);
});

/**
 * Entry point
 */
if (require.main === module) {
  validateEnvironment();
  startScheduler();
}

module.exports = {
  processQueue,
  startScheduler,
  validateEnvironment,
  getPageSummaries,
};
