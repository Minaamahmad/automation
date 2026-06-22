require('dotenv').config();
const cron = require('node-cron');
const queue = require('./queue');
const { downloadVideo, deleteArtifacts } = require('./downloader');
const { uploadToFacebook } = require('./uploader');
const logger = require('./logger');

// Load environment variables
const FB_PAGE_ID = process.env.FB_PAGE_ID;
const FB_PAGE_ACCESS_TOKEN = process.env.FB_PAGE_ACCESS_TOKEN;
const CRON_SCHEDULE = process.env.CRON_SCHEDULE || '0 * * * *';

/**
 * Validate environment setup on startup
 */
function validateEnvironment() {
  console.log('\n=== TikTok → Facebook Bot Starting ===\n');

  if (!FB_PAGE_ID || FB_PAGE_ID === 'your_page_id_here') {
    console.error('❌ Error: FB_PAGE_ID not configured in .env');
    process.exit(1);
  }

  if (!FB_PAGE_ACCESS_TOKEN || FB_PAGE_ACCESS_TOKEN === 'your_long_lived_page_token_here') {
    console.error('❌ Error: FB_PAGE_ACCESS_TOKEN not configured in .env');
    process.exit(1);
  }

  console.log('✓ Environment validated');
  console.log(`✓ Facebook Page ID: ${FB_PAGE_ID}`);
  console.log(`✓ Cron Schedule: ${CRON_SCHEDULE}`);
  console.log('✓ Bot ready\n');

  logger.logInfo('Bot started');
}

/**
 * Main processing function - runs on each cron tick
 */
async function processQueue() {
  console.log('\n--- Cron tick started ---');

  try {
    // 1. Get next URL from queue (now returns { url, tags })
    const item = queue.getNextUrl();

    if (!item) {
      console.log('Queue is empty. Nothing to process.');
      logger.logInfo('Queue empty, skipping');
      return;
    }

    const tiktokUrl = item.url;
    const tags = item.tags || [];

    console.log(`Processing: ${tiktokUrl}`);
    if (tags.length > 0) {
      console.log(`Tags: ${tags.join(' ')}`);
    }

    let downloadResult = null;

    try {
      // 2. Download video
      console.log('Step 1/4: Downloading video...');
      downloadResult = await downloadVideo(tiktokUrl);

      // 3. Upload to Facebook
      console.log('Step 2/4: Uploading to Facebook...');
      const fbVideoId = await uploadToFacebook(
        downloadResult.videoPath,
        FB_PAGE_ID,
        FB_PAGE_ACCESS_TOKEN,
        {
          title: downloadResult.title,
          description: downloadResult.description,
          thumbnailPath: downloadResult.thumbnailPath,
        },
        tags
      );

      // 4. Delete video after successful upload
      console.log('Step 3/4: Cleaning up downloaded files...');
      deleteArtifacts(downloadResult);
      downloadResult = null;

      // 5. Log success
      console.log('Step 4/4: Logging success...');
      logger.logSuccess(tiktokUrl, fbVideoId);

      // 6. Mark as done
      queue.markAsDone(tiktokUrl);

      console.log('✓ Processing completed successfully\n');
    } catch (error) {
      // Log failure but continue bot operation
      const errorMsg = error.message || String(error);
      console.error(`✗ Processing failed: ${errorMsg}`);
      logger.logFailure(tiktokUrl, errorMsg);

      // Still mark as done so we don't retry forever
      queue.markAsDone(tiktokUrl, "failed");

      // Clean up temp files on failure too
      if (downloadResult) {
        deleteArtifacts(downloadResult);
      }
    }
  } catch (error) {
    console.error('Unexpected error in processQueue:', error);
    logger.logInfo(`Unexpected error: ${error.message}`);
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
};
