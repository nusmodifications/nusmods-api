import { readFile } from 'xlsx';
import path from 'path';
import fs from 'fs-promise';
import bunyan from 'bunyan';
import R from 'ramda';
import moment from 'moment';
import clean from 'underscore.string/clean';
import mode from '../utils/mode';
import titleize from '../utils/titleize';


/**
 * Splits semester data into different chunks.
 * By default outputs to:
 *   - moduleCodes.json
 *   - moduleList.json
 *   - timetable.json
 *   - moduleInformation.json
 *   - venueInformation.json
 * And indivually write each module's information to:
 *   - modules/XModule.json
 *   - modules/XModule/CorsBiddingStats.json
 *   - modules/XModule/ivle.json
 *   - modules/XModule/timetable.json
 *   - modules/XModule/index.json
 */

const log = bunyan.createLogger({ name: 'parseExcel' });

const EXCEL_EPOCH = moment('01/01/1900', 'MM/DD/YYYY');

const DAY_MAP = {
  MON: 'Monday',
  TUE: 'Tuesday',
  WED: 'Wednesday',
  THU: 'Thursday',
  FRI: 'Friday',
  SAT: 'Saturday',
  SUN: 'Sunday',
};

const KEYS_MAP = {
  'Catalog Nbr': 'Catalog',
  Title: 'ModuleTitle',
  'Class Day': 'DayText',
  Day: 'DayText',
  'Start Time': 'StartTime',
  Start: 'StartTime',
  'End Time': 'EndTime',
  End: 'EndTime',
  'Start Date': 'StartDate',
  'End Date': 'EndDate',
  Section: 'ClassNo',
  Instructor: 'Lecturers',
};

const MODULE_FIELDS = [
  'ModuleCode',
  'ModuleTitle',
  'Lecturers',
  'Timetable',
];

const LESSON_FIELDS = [
  'ClassNo',
  'DayText',
  'StartTime',
  'EndTime',
  'Venue',
  'StartDate',
  'EndDate',
];

function sheetToObj(sheet) {
  const result = [];
  Object.keys(sheet).forEach((key) => {
    /* all keys that begin with "!" are not cell addresses */
    if (key[0] === '!') {
      return;
    }
    const col = R.head(key.match(/[A-Z]+/));
    const row = R.head(key.match(/\d+/));
    result[row] = result[row] || {};
    result[row][col] = sheet[key].v;
  });
  return result;
}

function normalize(rawData) {
  const rawHeader = R.head(rawData);
  const header = Object.values(rawHeader).map((val) => {
    if (Object.prototype.hasOwnProperty.call(KEYS_MAP, val)) {
      return KEYS_MAP[val];
    }
    return val;
  });
  const dataCols = R.tail(rawData);

  const lessons = dataCols.map(row => R.zipObj(Object.values(header), Object.values(row)));
  const normalized = lessons.map((les) => {
    const lesson = les;
    let moduleCode = '';
    Object.keys(lesson).forEach((key) => {
      if (key.includes('Lecturers')) {
        lesson[key] = titleize(lesson[key]);
      } else if (key.includes('Date') && Number.isInteger(lesson[key])) {
        const date = moment(EXCEL_EPOCH).add(lesson[key], 'days');
        lesson[key] = date.format();
      } else if (key === 'DayText' && /[A-Z]{3}/.test(lesson[key])) {
        lesson[key] = DAY_MAP[lesson[key]];
      } else if (key.includes('Subject') || key.includes('Catalog')) {
        moduleCode += lesson[key];
      }
      lesson[key] = clean(lesson[key]);
    });
    lesson.ModuleCode = moduleCode.replace(/\s+/g, '');
    return lesson;
  });
  return normalized;
}

function consolidate(lessons) {
  function pluckSingle(property, arr) {
    const props = R.uniq(R.pluck(property, arr));
    if (props.length > 1) {
      throw new Error(`${property} should only contain single piece of data, found ${props}`);
    }
    return R.head(props);
  }
  function consolidateModule(moduleLessons) {
    const consolidateTimetable = R.pipe(
      R.map(R.pick(LESSON_FIELDS)),
      // https://developer.mozilla.org/en/docs/Web/JavaScript/Reference/Global_Objects/String/localeCompare
      // undefined takes system locale
      R.sort((a, b) => a.ClassNo.localeCompare(b.ClassNo, undefined, { numeric: true })),
    );
    return {
      ModuleCode: pluckSingle('ModuleCode', moduleLessons),
      ModuleTitle: pluckSingle('ModuleTitle', moduleLessons),
      Lecturers: R.uniq(R.pluck('Lecturers', moduleLessons)),
      Timetable: consolidateTimetable(moduleLessons),
    };
  }
  return R.pipe(
    R.groupWith(R.eqProps('ModuleCode')),
    R.map(consolidateModule),
  )(lessons);
}

async function parseExcel(config) {
  const { year, semester } = config;
  const subLog = log.child({ year, semester });

  const basePath = path.join(
    config.destFolder,
    `${year}-${year + 1}`,
    semester.toString(),
  );

  const pathToRead = path.join(
    basePath,
    config.destFileName,
  );
  const workbook = readFile(pathToRead, { cellDates: true });
  const worksheet = workbook.Sheets[workbook.SheetNames[0]];
  const arrayOfCols = sheetToObj(worksheet);

  const lengths = arrayOfCols.map(row => Object.keys(row).length);

  const dataLength = mode(lengths);

  arrayOfCols.slice(0, 6).forEach((row) => {
    const length = Object.keys(row).length;
    if (length >= dataLength) {
      throw new Error(`row has exceeded normal range, found ${length}`);
    }
  });

  const rawData = arrayOfCols.filter(row => Object.keys(row).length === dataLength);
  const modules = consolidate(normalize(rawData));
  subLog.info(`parsed ${modules.length} modules.`);
  async function write(fileName, data) {
    const pathToWrite = path.join(
      basePath,
      fileName,
    );
    subLog.info(`saving to ${pathToWrite}`);
    await fs.outputJson(pathToWrite, data, { spaces: config.jsonSpace });
  }
  return write('smu.json', modules);
}

export default parseExcel;
