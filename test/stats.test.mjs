import * as S from '../js/stats.js';

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const ok = Object.is(got, want) || (typeof got === 'number' && Math.abs(got - want) < 1e-6);
  ok ? pass++ : fail++;
  console.log(`${ok ? 'OK  ' : 'FAIL'}  ${name}  ->  ${got}${ok ? '' : `   (esperado ${want})`}`);
};

const s = (ms, penalty = 'none') => ({ ms, penalty });

// --- penalizaciones ---
eq('+2 suma 2000ms', S.effective(s(10000, '+2')), 12000);
eq('DNF es infinito', S.effective(s(10000, 'DNF')), Infinity);

// --- ao5 ---
eq('ao5 recorta mejor y peor',
   S.aoN([s(10000), s(11000), s(12000), s(13000), s(14000)], 5), 12000);

eq('ao5 con UN DNF sigue siendo valida',
   S.aoN([s(10000), s(11000), s(12000), s(13000), s(0,'DNF')], 5), 12000);

eq('ao5 con DOS DNF es DNF',
   S.aoN([s(10000), s(11000), s(12000), s(0,'DNF'), s(0,'DNF')], 5), Infinity);

// El 10.00+2 pasa a valer 12.00 y cambia de posicion en el orden:
// efectivos 10,11,12,13,12 -> se recortan 10 y 13 -> media(11,12,12)
eq('ao5 aplica +2 antes de ordenar y recortar',
   S.aoN([s(10000), s(11000), s(12000), s(13000), s(10000,'+2')], 5), 35000/3);

eq('ao5 con 4 solves no existe todavia',
   S.aoN([s(10000), s(11000), s(12000), s(13000)], 4 + 1), null);

// --- ao12: recorta 1 por lado, promedia 10 ---
const doce = [1,2,3,4,5,6,7,8,9,10,11,12].map(n => s(n * 1000));
eq('ao12 = media de 2..11', S.aoN(doce, 12), 6500);

eq('ao12 con un DNF: se va con el recorte del peor',
   S.aoN([...doce.slice(0, 11), s(0, 'DNF')], 12),
   [2,3,4,5,6,7,8,9,10,11].reduce((a,b)=>a+b,0) / 10 * 1000);

// --- ao100: recorta 5% por lado ---
const cien = Array.from({length: 100}, (_, i) => s((i + 1) * 1000));
eq('ao100 = media de 6..95', S.aoN(cien, 100), 50500);

// --- mo3: sin recortes ---
eq('mo3 es media simple', S.moN([s(10000), s(11000), s(12000)], 3), 11000);
eq('mo3 con un DNF es DNF', S.moN([s(10000), s(11000), s(0,'DNF')], 3), Infinity);

// --- usa los ULTIMOS n ---
eq('aoN usa los ultimos n',
   S.aoN([s(99000), s(10000), s(11000), s(12000), s(13000), s(14000)], 5), 12000);

// --- mejor ao5 deslizante ---
eq('bestAo5 encuentra la mejor ventana',
   S.bestAoN([s(20000),s(20000),s(20000),s(20000),s(20000),
              s(10000),s(11000),s(12000),s(13000),s(14000)], 5), 12000);

// --- singles ---
eq('bestSingle ignora DNF', S.bestSingle([s(9000,'DNF'), s(12000), s(15000)]), 12000);

// --- formato ---
eq('fmt sub-minuto', S.fmt(1234), '1.23');
eq('fmt con minutos', S.fmt(65432), '1:05.43');
eq('fmt trunca a centesimas', S.fmt(9999), '9.99');
eq('fmt DNF', S.fmt(Infinity), 'DNF');
eq('fmt nulo', S.fmt(null), '—');
eq('fmtSolve marca el +2', S.fmtSolve(s(10000,'+2')), '12.00+');
eq('fmtSolve DNF', S.fmtSolve(s(10000,'DNF')), 'DNF');

console.log(`\n${pass} pasan, ${fail} fallan`);
process.exit(fail ? 1 : 0);
