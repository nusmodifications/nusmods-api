import bulletinModules from './remote/bulletinModules';
import cors from './remote/cors';
import corsBiddingStats from './remote/corsBiddingStats';
import examTimetable from './remote/examTimetable';
import ivle from './remote/ivle';
import moduleTimetableDelta from './remote/moduleTimetableDelta';
import venues from './remote/venues';
import smu from './remote/smu';
import ntuDetails from './remote/ntuDetails';
import ntuLessons from './remote/ntuLessons';
import mergeCorsBiddingStats from './local/mergeCorsBiddingStats';
import consolidateForSem from './local/consolidateForSem';
import consolidateForYear from './local/consolidateForYear';
import splitForSem from './local/splitForSem';
import splitForYear from './local/splitForYear';
import parseExcel from './local/parseExcel';

export default {
  bulletinModules,
  cors,
  corsBiddingStats,
  examTimetable,
  ivle,
  moduleTimetableDelta,
  venues,
  smu,
  ntuDetails,
  ntuLessons,
  mergeCorsBiddingStats,
  consolidateForSem,
  splitForSem,
  consolidateForYear,
  splitForYear,
  parseExcel,
};
