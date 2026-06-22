require('dotenv').config();
const fs = require('fs');
const { execSync } = require('child_process');

const p = process.env.YT_DLP_PATH;
console.log('YT_DLP_PATH=' + p);
console.log('EXISTS=' + fs.existsSync(p));
console.log('VERSION=' + execSync('"' + p + '" --version', { encoding: 'utf8' }).trim());
