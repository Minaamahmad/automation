/**
 * Load configured Facebook Pages from environment variables.
 *
 * Page 1 (required): FB_PAGE_ID + FB_PAGE_ACCESS_TOKEN
 * Optional labels:  FB_PAGE_KEY, FB_PAGE_NAME
 *
 * Extra pages:      FB_PAGE_2_KEY, FB_PAGE_2_NAME, FB_PAGE_2_ID, FB_PAGE_2_TOKEN
 *                   FB_PAGE_3_... up to FB_PAGE_10_...
 */

function sanitizeToken(token) {
  return String(token || '')
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/,$/, '');
}

function loadPages() {
  const pages = [];

  const page1Id = process.env.FB_PAGE_ID;
  const page1Token = sanitizeToken(process.env.FB_PAGE_ACCESS_TOKEN);
  if (page1Id && page1Token && page1Id !== 'your_page_id_here') {
    pages.push({
      key: (process.env.FB_PAGE_KEY || 'default').trim(),
      name: (process.env.FB_PAGE_NAME || 'Page 1').trim(),
      id: page1Id.trim(),
      token: page1Token,
    });
  }

  for (let i = 2; i <= 10; i += 1) {
    const id = process.env[`FB_PAGE_${i}_ID`];
    const token = sanitizeToken(process.env[`FB_PAGE_${i}_TOKEN`]);
    if (!id || !token) continue;

    pages.push({
      key: (process.env[`FB_PAGE_${i}_KEY`] || `page${i}`).trim(),
      name: (process.env[`FB_PAGE_${i}_NAME`] || `Page ${i}`).trim(),
      id: id.trim(),
      token,
    });
  }

  return pages;
}

function getPages() {
  return loadPages();
}

function getPageSummaries() {
  return getPages().map(({ key, name, id }) => ({ key, name, id }));
}

function getDefaultPageKey() {
  const pages = getPages();
  return pages[0]?.key || 'default';
}

function getPage(pageKey) {
  const pages = getPages();
  if (pages.length === 0) {
    return null;
  }

  const normalizedKey = String(pageKey || '').trim();
  if (!normalizedKey || normalizedKey === 'default') {
    return pages[0];
  }

  const match = pages.find((page) => page.key === normalizedKey);
  if (match) {
    return match;
  }

  throw new Error(
    `Unknown Facebook page "${pageKey}". Check FB_PAGE_* settings in .env.`
  );
}

function validatePages() {
  const pages = getPages();
  if (pages.length === 0) {
    throw new Error('No Facebook pages configured. Set FB_PAGE_ID and FB_PAGE_ACCESS_TOKEN in .env');
  }

  const keys = new Set();
  for (const page of pages) {
    if (keys.has(page.key)) {
      throw new Error(`Duplicate Facebook page key "${page.key}" in .env`);
    }
    keys.add(page.key);
  }

  return pages;
}

module.exports = {
  getPages,
  getPageSummaries,
  getPage,
  getDefaultPageKey,
  validatePages,
};
