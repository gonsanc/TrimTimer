import { inspectionPenalty } from '../js/timer.js';

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const ok = got === want;
  ok ? pass++ : fail++;
  console.log(`${ok ? 'OK  ' : 'FAIL'}  ${name}  ->  ${got}${ok ? '' : `   (esperado ${want})`}`);
};

// Los limites son donde viven los bugs de esto.
eq('0s sin penalizacion',            inspectionPenalty(0),     'none');
eq('14.999s todavia limpio',         inspectionPenalty(14999), 'none');
eq('15.000s exactos siguen limpios', inspectionPenalty(15000), 'none');
eq('15.001s ya es +2',               inspectionPenalty(15001), '+2');
eq('16.5s es +2',                    inspectionPenalty(16500), '+2');
eq('17.000s exactos aun son +2',     inspectionPenalty(17000), '+2');
eq('17.001s es DNF',                 inspectionPenalty(17001), 'DNF');
eq('30s es DNF',                     inspectionPenalty(30000), 'DNF');

console.log(`\n${pass} pasan, ${fail} fallan`);
process.exit(fail ? 1 : 0);
