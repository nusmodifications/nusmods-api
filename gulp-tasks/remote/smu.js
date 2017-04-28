import path from 'path';
import fs from 'fs-promise';
import bunyan from 'bunyan';
import querystring from 'querystring';
import got from 'got';
import R from 'ramda';
import cheerio from 'cheerio';
import gotCached from '../utils/gotCached';

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

async function getExcel(response) {
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
  const res = await got(destUrl, { query, encoding: null });
  return res.body;
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
  };
  const res = await got(url, options);
  return getExcel(res, config);
}

async function smu(config) {
  const { year, semester } = config;
  const acadYear = `${year}-${year + 1}`;
  const subLog = log.child({ year, semester });

  const mainPage = await gotCached(ROOT_URL, config);
  const $ = cheerio.load(mainPage);
  const links = $('#content a').map((i, el) => $(el).attr('href')).get();
  const excels = links.filter(link => link.includes(`/Term ${semester} ${acadYear}.xlsx`));
  if (excels.length > 1) {
    throw new Error(`Only one excel link should be found, found ${excels}`);
  } else if (excels.length === 0) {
    subLog.info('excel file link not found, scrape ended.');
    return;
  }
  const response = await got(R.head(excels), config);
  const modules = await accessResponse(response, config);

  const pathToWrite = path.join(
    config.destFolder,
    acadYear,
    semester.toString(),
    config.destFileName,
  );
  subLog.info(`saving to ${pathToWrite}`);
  await fs.outputFile(pathToWrite, modules);
}

export default smu;
