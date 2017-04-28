import path from 'path';
import fs from 'fs-extra';
import url from 'url';
import got from 'got';
import tough from 'tough-cookie';
import parse5 from 'parse5';
import isBinaryPath from 'is-binary-path';
import bunyan from 'bunyan';

const log = bunyan.createLogger({ name: 'gotCached' });

/**
 * Converts URL to equivalent valid filename.
 */
function getCachePath(urlStr, cachePath) {
  const fileUrl = url.parse(urlStr);
  const pathAndHash = fileUrl.path + (fileUrl.hash ? fileUrl.hash : '');
  const hostname = encodeURIComponent(fileUrl.hostname);
  const restOfPath = encodeURIComponent(pathAndHash).slice(0, 255);
  return path.join(cachePath, hostname, restOfPath);
}

/**
 * Gets the time the file was last modified if it exists, null otherwise.
 */
async function getFileModifiedTime(cachedPath, urlStr) {
  try {
    const stats = await fs.stat(cachedPath);
    if (stats.isFile()) {
      return stats.mtime;
    }
    log.warn(`${cachedPath} is not a file`);
  } catch (err) {
    log.info(`no cached file for ${urlStr}`);
  }
  return null;
}

async function gotCached(urlStr, config) {
  const cachedPath = getCachePath(urlStr, config.cachePath);
  function returnCached() {
    log.info(`returning cached file for ${urlStr}`);
    return fs.readFile(cachedPath);
  }

  const modifiedTime = await getFileModifiedTime(cachedPath, urlStr);
  const maxCacheAge = config.maxCacheAge;
  const isCachedFileValid = modifiedTime && (modifiedTime > Date.now() - (maxCacheAge * 1000));
  if (maxCacheAge === -1 || isCachedFileValid) {
    return returnCached();
  }

  const options = {
    // returns body as a buffer instead of string if its a binary file
    encoding: isBinaryPath(urlStr) ? null : 'utf-8',
    ...config,
  };
  if (modifiedTime) {
    options.headers = config.headers || {};
    const modifedTimeString = (new Date(modifiedTime)).toUTCString();
    options.headers['if-modified-since'] = modifedTimeString;
  }
  try {
    const response = await got(urlStr, options);
    let body = response.body;
    if (response.headers['content-type'] === 'text/html') {
      // Serializes the parsed document
      const doc = parse5.parse(body);
      body = parse5.serialize(doc);
    }
    await fs.outputFile(cachedPath, body);
    return body;
  } catch (error) {
    if (error.statusCode === 304) {
      return returnCached();
    }
    if (error.statusCode) {
      throw new Error(`got http ${error.statusCode} while fetching ${urlStr}`);
    }
    throw error;
  }
}

async function gotCookied(urlStr, config) {
  const Cookie = tough.Cookie;
  try {
    const res = await got(urlStr, config);
    let cookies;
    if (res.headers['set-cookie'] instanceof Array) {
      cookies = res.headers['set-cookie'].map(Cookie.parse);
    } else {
      cookies = [Cookie.parse(res.headers['set-cookie'])];
    }
    console.log(cookies);
    const options = {
      ...config,
      headers: { cookie: cookies[0] },
    };
    return await gotCached(urlStr, options);
  } catch (error) {
    throw error;
  }
}

export default gotCached;
export { gotCookied };
