import path from 'path';
import fs from 'fs-extra';
import bunyan from 'bunyan';
import R from 'ramda';
import cheerio from 'cheerio';
import moment from 'moment';
import isBlank from 'underscore.string/isBlank';
import clean from 'underscore.string/clean';
import titleize from '../utils/titleize';
import gotCached from '../utils/gotCached';
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

const ROOT_URL = 'https://wish.wis.ntu.edu.sg/webexe/owa/AUS_SCHEDULE.main_display1?';

const log = bunyan.createLogger({ name: 'ntuLessons' });

function processModule(tables) {
  const $ = cheerio.load(tables);
  const details = $('table').first();
  const lessons = $('table').last();

  const detailsRows = $('tr', details).toArray();
  // first row contains code, title, credit and department
  const firstRow = $('td', R.head(detailsRows));
  const module = {
    ModuleCode: firstRow.eq(0).text(),
    ModuleTitle: firstRow.eq(1).text(),
    ModuleCredit: firstRow.eq(2).text(),
  };

  // second row onwards either contains prerequisites or module level remarks
  // since we parse prerequisites in ntuDetails, we shall ignore those
  R.tail(detailsRows).forEach((row) => {
    const cols = $('td', row);
    if (cols.first().text() === 'Remark:') {
      module.Remark = cols.last().text();
    }
  });

  const lessonRows = $('tr', lessons).toArray();
  // ignore headers (first row)
  const timetable = R.tail(lessonRows).map((row) => {
    const cols = $('td', row);
    const timing = cols.eq(4).text().split('-');
    return {
      LessonType: cols.eq(1).text(),
      ClassNo: cols.eq(2).text(),
      DayText: cols.eq(3).text(),
      StartTime: R.head(timing),
      EndTime: R.last(timing),
      WeekText: cols.eq(6).text(),
      Venue: cols.eq(5).text(),
    };
  });
  module.Timetable = timetable;
  return R.map(clean, module);
}

function processListings(webpage) {
  const $ = cheerio.load(webpage);
  const toPairs = R.splitEvery(2);
  const tables = $('table').toArray();
  if (tables.length % 2 !== 0) {
    throw new Error('Odd number of tables found, should be even (a pair for each module).');
  }
  const rawModules = toPairs(tables);
  return rawModules.slice(1, 5).map(processModule);
}

async function ntuLessons(config) {
  const { year, semester } = config;
  const subLog = log.child({ year, semester });

  // eslint-disable-next-line max-len
  const url = `${ROOT_URL}staff_access=false&acadsem=${year};${semester}&r_subj_code=&boption=Search&r_search_type=F`;
  const webpage = await gotCached(url, config);
  const modules = processListings(webpage);
  log.info(modules);
  subLog.info(`parsed ${modules.length} ntuLessons modules`);

  const pathToWrite = path.join(
    config.destFolder,
    `${year}-${year + 1}`,
    semester.toString(),
    config.destFileName,
  );
  subLog.info(`saving to ${pathToWrite}`);
  await fs.outputJson(pathToWrite, modules, { spaces: config.jsonSpace });
}

export default ntuLessons;
