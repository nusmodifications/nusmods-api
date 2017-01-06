import path from 'path';
import fs from 'fs-promise';
import bunyan from 'bunyan';
import querystring from 'querystring';
import got from 'got';
import R from 'ramda';
import tough from 'tough-cookie';
import cheerio from 'cheerio';
import moment from 'moment';
import Horseman from 'node-horseman';
import Promise from 'bluebird';
import clean from 'underscore.string/clean';
import gotCached, { gotCookied } from '../utils/gotCached';
import sortByKey from '../utils/sortByKey';

/**
 * Outputs cors data for regular sems (1 & 2) or
 * special sems (3 & 4).
 * Also outputs lesson types that are either
 * lectures or tutorials.
 * By default outputs to:
 *   - corsRaw.json
 *   - lessonTypes.json
 */

const ROOT_URL = 'https://inet.smu.edu.sg/sites/courses/Pages/Class-Timetable.aspx';
const CONTEXT_NAME = 'm_excelWebRenderer$ewaCtl$m_workbookContextJson';

const log = bunyan.createLogger({ name: 'smu' });

function processListings(webpage, config) {
  const $ = cheerio.load(webpage);
  const links = $('#content a').map((i, el) => {
    return $(el).attr('href');
  }).get();
  const excels = links.filter(link => link.includes('.xlsx'));
  return got(R.head(excels), config);
}

function setCookie(response) {
  const instructions = response.headers['set-cookie'];
  let cookie;
  if (instructions instanceof Array) {
    cookie = R.head(instructions);
  } else {
    cookie = instructions;
  }
  return tough.Cookie.parse(cookie);
}

async function accessResponse(response, config) {
  const $ = cheerio.load(response.body);
  const form = {};
  const url = $('form').attr('action');
  $('form').serializeArray().forEach(({ name, value }) => {
    form[name] = value;
  });
  const options = {
    ...config,
    body: form,
    // headers: { cookie: setCookie(response) },
  }
  const res = await got(url, options);
  return getExcel(res, config);
}

async function getExcel(response, config) {
  const $ = cheerio.load(response.body);
  const context = $(`[name="${CONTEXT_NAME}"]`).attr('value');
  const jsonContext = JSON.parse(context);

  const idObj = querystring.parse(jsonContext.WorkbookUri);
  idObj.sc = encodeURI(ROOT_URL);

  const query = {
    id: querystring.stringify(idObj),
    sessionId: jsonContext.SessionId,
    workbookFileName: jsonContext.WorkbookFileName,
    workbookType: 'FullWorkbook',
    NoAuth: 1,
  };
  const destUrl = 'https://o.inet.smu.edu.sg/x/_layouts/XlFileHandler.aspx';
  const res = await gotCached(destUrl, { ...config, query });
}

async function smu(config) {
  const { year, semester } = config;
  const subLog = log.child({ year, semester });

  const mainPage = await gotCached(ROOT_URL, config);
  const response = await processListings(mainPage, config);
  const modules = await accessResponse(response, config);

  const pathToWrite = path.join(
    config.destFolder,
    `${year}-${year + 1}`,
    semester.toString(),
    config.destFileName,
  );
  subLog.info(`saving to ${pathToWrite}`);
  await fs.outputJson(pathToWrite, modules, { spaces: config.jsonSpace });
  return modules;
}

export default smu;
