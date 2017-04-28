import path from 'path';
import fs from 'fs-promise';
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

const ROOT_URL = 'https://wish.wis.ntu.edu.sg/webexe/owa/aus_subj_cont.main_display1?';

const log = bunyan.createLogger({ name: 'ntuDetails' });

function processModule(rows) {
  const $ = cheerio.load(rows);
  const firstRow = $('td', R.head(rows));

  const module = {
    ModuleCode: firstRow.eq(0).text(),
    ModuleTitle: titleize(firstRow.eq(1).text()),
    ModuleCredit: firstRow.eq(2).text(),
    Department: firstRow.eq(3).text(),
  };

  const restOfRows = R.tail(rows);
  restOfRows.forEach((row, i) => {
    const color = $('font', row).attr('color');
    const text = $(row).text();
    if (isBlank(text)) {
      return;
    }
    if (color === '#FF00FF') {
      module.Prerequisite = text;
    } else if (color === 'RED') {
      module.Remarks = text;
    } else if (color === 'BROWN') {
      module.Preclusion = text;
    } else if (color === 'GREEN') {
      module.Availability = text;
    } else if (color === 'BLUE') {
      module.Remarks = text;
    } else if (i === restOfRows.length - 1) {
      module.Description = text;
    } else {
      log.info(`New data category found: ${$(row).html()}`);
    }
  });
  return R.map(clean, module);
}

function processListings(webpage) {
  const $ = cheerio.load(webpage);
  const rawModules = [[]];
  $('tr').each((i, el) => {
    const tr = $(el);
    if (tr.html().includes('<td>&#xA0;</td>')) {
      rawModules.push([]);
    } else {
      rawModules[rawModules.length - 1].push(el);
    }
  });
  return rawModules.slice(1, -1).map(processModule);
}

async function ntuDetails(config) {
  const { year, semester } = config;
  const subLog = log.child({ year, semester });

  const url = `${ROOT_URL}acad=${year}&semester=${semester}&acadsem=${year};1&r_subj_code=&boption=Search`;
  const webpage = await gotCached(url, config);
  const modules = processListings(webpage);
  subLog.info(`parsed ${modules.length} ntuDetails modules`);

  const pathToWrite = path.join(
    config.destFolder,
    `${year}-${year + 1}`,
    semester.toString(),
    config.destFileName,
  );
  subLog.info(`saving to ${pathToWrite}`);
  await fs.outputJson(pathToWrite, modules, { spaces: config.jsonSpace });
}

export default ntuDetails;
