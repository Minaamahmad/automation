# TikTok → Facebook Page Auto-Poster Bot

A Node.js automation bot that reads TikTok video links from a queue file, downloads them without watermark, and automatically uploads them to a Facebook Page via the Graph API.

## Features

- 🎬 Downloads TikTok videos **without watermark** using `yt-dlp`
- 📱 Uploads to Facebook Page via **resumable Video API** (better HD processing)
- 🏷️ Sends **title**, **description**, and **custom thumbnail** from TikTok metadata
- 🌐 Mobile-friendly website dashboard for adding links from any browser
- ⏰ Runs on configurable cron schedule (default: every hour)
- 📝 Detailed logging of all operations
- 🔄 Processes one video per cron tick to respect rate limits
- 🗑️ Auto-cleanup of temporary files

## Project Structure

```
tiktok-fb-bot/
├── index.js            # Entry point, cron scheduler
├── server.js           # Express web dashboard + background scheduler
├── public/             # Mobile-friendly web UI
├── downloader.js       # yt-dlp wrapper (download without watermark)
├── uploader.js         # Facebook resumable Video API uploader
├── queue.js            # Reads and manages links.txt
├── logger.js           # Append-only log writer
├── links.txt           # One TikTok URL per line (you add manually)
├── logs.txt            # Auto-generated run logs
├── downloads/          # Temp folder for downloaded videos
├── .env                # Secret config (tokens, page ID, schedule)
├── .gitignore          # Git ignore patterns
├── package.json        # Node.js dependencies
└── README.md           # This file
```

## Prerequisites

- **Node.js** (v14+): [download here](https://nodejs.org/)
- **Python** (v3.7+): [download here](https://www.python.org/)
- **yt-dlp**: Video downloader (install via pip)
- **Facebook Developer Account**: [developers.facebook.com](https://developers.facebook.com/)

## Installation

### 1. Verify Prerequisites

```bash
node --version    # Should be v14 or higher
python --version  # Should be v3.7 or higher
```

### 2. Install yt-dlp (System-wide)

```bash
pip install yt-dlp
```

Verify installation:

```bash
yt-dlp --version
```

### 3. Install Node Dependencies

```bash
npm install
```

### 4. Get Facebook Credentials

1. Go to [developers.facebook.com](https://developers.facebook.com/)
2. Create a new App (or use existing)
3. Add **"Pages API"** product to your app
4. Navigate to **Apps → Your App → Tools → Graph API Explorer**
5. Select your Facebook Page in the dropdown
6. Generate a **Long-Lived Page Access Token** (not a user token)
7. Make sure the token has at least **pages_manage_posts** and **publish_video** permissions
8. Copy your **Page ID** (visible in page settings)

### 5. Configure `.env`

Edit `.env` with your credentials:

```env
FB_PAGE_ID=123456789
FB_PAGE_ACCESS_TOKEN=your_long_lived_page_access_token_here
FB_POST_PUBLISHED=true
FB_GRAPH_API_VERSION=v20.0
CRON_SCHEDULE=0 * * * *
```

**Optional environment variables:**

| Variable | Default | Purpose |
|----------|---------|---------|
| `FB_GRAPH_API_VERSION` | `v20.0` | Graph API version for video uploads |
| `FB_POST_PUBLISHED` | `true` | Publish immediately (`false` = upload as unpublished draft) |
| `DOWNLOADS_DIR` | OS temp dir on Windows, `./downloads` elsewhere | Where yt-dlp saves temp files |
| `YT_DLP_PATH` | auto-detected | Path to `yt-dlp` executable |
| `YT_DLP_IMPERSONATE` | `Chrome-124` | Browser impersonation target for TikTok |

**CRON_SCHEDULE** format (minute hour day month dayOfWeek):
- `0 * * * *` = Every hour at minute 0
- `0 0 * * *` = Daily at midnight
- `*/30 * * * *` = Every 30 minutes
- `0 9 * * MON` = Every Monday at 9 AM

## Usage

### Add Videos to Queue

Edit `links.txt` and add TikTok URLs (one per line). You can optionally add hashtags/tags:

```
https://www.tiktok.com/@user1/video/123456789
https://www.tiktok.com/@user2/video/987654321 #funny #viral
https://www.tiktok.com/@user3/video/555555555 #dance #trending #music
```

**Format:** `https://url.com/video #tag1 #tag2 #tag3`

Tags (up to 3) are appended to the Facebook video description. The TikTok title and creator caption are extracted automatically during download.

### Start the Bot

```bash
npm start
```

Then open:

```text
http://localhost:3000
```

To run this on a real server (so it keeps working without your PC), deploy the project to Render / Railway / VPS and make sure `YT_DLP_PATH=yt-dlp` is available in the environment.

The bot will:

1. ✓ Run first check immediately
2. ✓ Download each video
3. ✓ Upload to your Facebook Page
4. ✓ Log results to `logs.txt`
5. ✓ Mark processed links with `#done`
6. ✓ Run again on the next cron tick

### Monitor Logs

View logs in real-time:

```bash
tail -f logs.txt
```

## Log Format

```
[2026-06-02 14:00:01] SUCCESS | https://tiktok.com/... | FB Video ID: 123456789
[2026-06-02 15:00:01] FAILED  | https://tiktok.com/... | Reason: Video unavailable
[2026-06-02 16:00:01] INFO    | Queue empty, skipping
```

## Troubleshooting

### ❌ "yt-dlp is not installed"

```bash
pip install yt-dlp
yt-dlp --version  # Verify
```

### ❌ "Facebook authentication failed"

- Check `FB_PAGE_ID` in `.env`
- Verify `FB_PAGE_ACCESS_TOKEN` is correct
- Token may have expired — generate a new one

### ❌ "Video is private or not available"

- The video may have been deleted or set to private
- Check the original TikTok URL manually
- The bot will mark it as done and skip it

### ❌ "No such file or directory: downloads"

The downloads folder should be created automatically. If not, create it manually:

```bash
mkdir downloads
```

## Facebook Upload Details

This bot posts **native videos** via `POST /{page-id}/videos` using Meta's **resumable 3-phase upload**:

1. **start** — initialize session with file size
2. **transfer** — upload binary chunks using API-provided byte offsets
3. **finish** — publish with `title`, `description`, `thumb`, and `published`

It uses `https://graph.facebook.com` (not the deprecated `graph-video.facebook.com` host).

**Note:** `POST /{page-id}/feed` with a `link` parameter is for link-preview posts, not native video uploads. This bot re-uploads the MP4 so the video plays natively on your Page.

## Performance Notes

- **One video per cron tick** — Processes videos sequentially to respect Facebook's rate limits
- **Resumable uploads** — Chunked transfer with per-chunk retries for reliability
- **5-minute timeout per download** — Retries and skips if yt-dlp takes too long
- **2GB file size limit** — Facebook's maximum video size
- **Rate limiting** — Space out uploads by adjusting CRON_SCHEDULE

## Security Notes

⚠️ **Never commit `.env` to version control!** It contains your access tokens.

- `.env` is listed in `.gitignore`
- Treat `FB_PAGE_ACCESS_TOKEN` as a password
- Rotate tokens every 60 days (Facebook requirement)
- Consider using a secrets manager for production

## Common Cron Schedules

| Schedule | Meaning |
|----------|---------|
| `0 * * * *` | Every hour |
| `*/30 * * * *` | Every 30 minutes |
| `0 0 * * *` | Daily at midnight |
| `0 9 * * *` | Every day at 9 AM |
| `0 9 * * MON-FRI` | Weekdays at 9 AM |
| `0 0 1 * *` | First day of month |

[Full cron syntax reference](https://crontab.guru/)

## Queue File Format

```
# Comments start with #
# Blank lines are ignored
https://www.tiktok.com/@user1/video/123  <- Unprocessed, no tags
https://www.tiktok.com/@user2/video/456 #funny #viral  <- Unprocessed, with tags
#done https://www.tiktok.com/@user3/video/789  <- Already processed
#done https://www.tiktok.com/@user4/video/999 #dance #music  <- Already processed with tags
```

**Tag Format:** Add hashtags after the URL separated by spaces. They'll appear in the Facebook post description.

## Stopping the Bot

Press `Ctrl+C` in the terminal. The bot will gracefully shut down and log the event.

## Future Enhancements

- [ ] Reels publishing mode (`/{page-id}/video_reels`) for vertical short-form clips
- [ ] Link-share mode (`POST /feed` with `link`) as an alternative to native upload
- [ ] Multi-account support (upload to multiple pages)
- [ ] Webhook notifications on success/failure
- [ ] Caption/hashtag templates
- [ ] Video format conversion (if needed)

## License

MIT

## Support

For issues with `yt-dlp`: [github.com/yt-dlp/yt-dlp](https://github.com/yt-dlp/yt-dlp)

For issues with Facebook API: [developers.facebook.com/docs](https://developers.facebook.com/docs)

---

**Made with ❤️ for TikTok creators on Facebook**
