import path from 'path';
import fs from 'fs-promise';
import bunyan from 'bunyan';
import got from 'got';
import R from 'ramda';
import tough from 'tough-cookie';
import cheerio from 'cheerio';
import moment from 'moment';
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

const ROOT_URL = 'http://eservices.smu.edu.sg/psc/ps/EMPLOYEE/HRMS/c/SIS_CR.SIS_CLASS_SEARCH.GBL';

const log = bunyan.createLogger({ name: 'smu' });

function processModulePage(webpage) {
  const $ = cheerio.load(webpage);
  const departmentDetails = $('.SSSKEYTEXT').text().split(' | ');
  const department = R.last(departmentDetails);

  const moduleDetails = $('.PALEVEL0SECONDARY').text().split(' - ');
  if (moduleDetails.length > 2) {
    throw new RangeError('moduleDetails should only have two components');
  }
  const moduleCode = R.head(moduleDetails).replace(/\s+/, '');
  const moduleTitle = R.last(moduleDetails);

  const tables = $('table.PSGROUPBOXWBO');

  function processTable(pos, labelValue) {
    const table = tables.eq(pos);
    const label = $('.PAGROUPDIVIDER', table).text();
    if (label !== labelValue) {
      throw new Error(`Label value '${labelValue}' not found where it should be, got '${label}'`);
    }
    const text = $('span', table).text();
    return text;
  }
  // description should be first
  const description = processTable(0, 'Description');
  if (tables.length > 2) {
    // requirements should be next
    const requirements = processTable(1, 'Enrollment Information');
  }

  // course components should be last
  processTable(-1, 'Course Detail');
  const courseTable = tables.eq(-1);
  const labels = $('label', courseTable).map((i, el) => $(el).text()).get();
  const spans = $('span', courseTable).map((i, el) => $(el).text()).get();
  const labelSpanPair = R.zipObj(labels, spans);

  const moduleCredit = labelSpanPair.Units;

  return {
    ModuleCode: moduleCode,
    Department: department,
    ModuleTitle: moduleTitle,
    ModuleDescription: description,
    ModuleCredit: moduleCredit,
    Prerequisite: null,
    Preclusion: null,
    Timetable: null,
  };
}

function processAlphabet(webpage) {
  const $ = cheerio.load(webpage);
  return $('a[title="Long Course Title"]').slice(0, 5).map((i, el) => $(el).attr('id')).get();
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

async function accessResponse(response, id, config) {
  const $ = cheerio.load(response.body);
  const form = {};
  $('form').serializeArray().forEach(({ name, value }) => {
    form[name] = value;
  });
  form.ICAction = id;
  console.log(form);
  const options = {
    ...config,
    body: form,
    headers: { cookie: setCookie(response) },
  };
  const res = await gotCached(ROOT_URL, options);
  console.log(res.body);
}

async function post(config) {
  try {
    // step 1: get cookies
    const initial = await got(ROOT_URL);
    // setp 2: access home page
    const response = await got(ROOT_URL, { headers: { cookie: setCookie(initial) } });
    const ids = processAlphabet(response.body);
    const module = await accessResponse(response, ids[0], config);
  } catch (error) {
    if (error.response) {
      console.log(error.response.body);
    }
    throw error;
  }
}

async function smu(config) {
  const { year, semester } = config;
  const subLog = log.child({ year, semester });

  const modules = await gotCached(ROOT_URL, config);
  const module = processModulePage(modules);

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
