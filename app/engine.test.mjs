// Headless kernel tests (SPEC build-sequence step 1). Run: node app/engine.test.mjs
import { computeAll, evalRoll, compileCalc, FormulaError, refsOf, previewRoll } from './engine.js';

let pass = 0, fail = 0;
function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; } else { fail++; console.error(`FAIL ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
}
function ok(name, cond) { cond ? pass++ : (fail++, console.error(`FAIL ${name}`)); }

// §15 canonical fragment
const values = [
  { id: 'strength', kind: 'number', value: 16 },
  { id: 'dexterity', kind: 'number', value: 14 },
  { id: 'str_mod', kind: 'calc', formula: 'floor((strength - 10) / 2)' },
  { id: 'dex_mod', kind: 'calc', formula: 'floor((dexterity - 10) / 2)' },
  { id: 'level', kind: 'number', value: 3 },
  { id: 'proficiency_bonus', kind: 'calc', formula: '2 + floor((level - 1) / 4)' },
  { id: 'armor_class', kind: 'calc', formula: '10 + dex_mod' },
  { id: 'initiative', kind: 'calc', formula: 'dex_mod' },
];
const { results, details } = computeAll(values);
eq('str_mod', results.get('str_mod'), 3);
eq('dex_mod', results.get('dex_mod'), 2);
eq('proficiency_bonus', results.get('proficiency_bonus'), 2);
eq('armor_class', results.get('armor_class'), 12);
eq('initiative', results.get('initiative'), 2);

// operator precedence & functions
eq('precedence', computeAll([{ id: 'a', kind: 'calc', formula: '2 + 3 * 4' }]).results.get('a'), 14);
eq('unary minus', computeAll([{ id: 'a', kind: 'calc', formula: '-5 + 3' }]).results.get('a'), -2);
eq('clamp', computeAll([{ id: 'a', kind: 'calc', formula: 'clamp(20, 0, 10)' }]).results.get('a'), 10);
eq('min var', computeAll([{ id: 'a', kind: 'calc', formula: 'min(3, 1, 2)' }]).results.get('a'), 1);
eq('max var', computeAll([{ id: 'a', kind: 'calc', formula: 'max(3, 1, 2)' }]).results.get('a'), 3);
eq('div by zero', computeAll([{ id: 'a', kind: 'calc', formula: '5 / 0' }]).results.get('a'), 0);
eq('mod by zero', computeAll([{ id: 'a', kind: 'calc', formula: '5 % 0' }]).results.get('a'), 0);

// refs extraction
eq('refsOf', refsOf('10 + dex_mod + str_mod').sort(), ['dex_mod', 'str_mod']);

// boolean leaf kind — resolves to 1/0 and multiplies into a formula (proficiency)
const profVals = [
  { id: 'dexterity', kind: 'number', value: 14 },
  { id: 'dex_mod', kind: 'calc', formula: 'floor((dexterity - 10) / 2)' },
  { id: 'level', kind: 'number', value: 5 },
  { id: 'proficiency_bonus', kind: 'calc', formula: '2 + floor((level - 1) / 4)' },
  { id: 'stealth_prof', kind: 'bool', value: true },
  { id: 'acrobatics_prof', kind: 'bool', value: false },
  { id: 'stealth', kind: 'calc', formula: 'dex_mod + stealth_prof * proficiency_bonus' },
  { id: 'acrobatics', kind: 'calc', formula: 'dex_mod + acrobatics_prof * proficiency_bonus' },
];
const pv = computeAll(profVals).results;
eq('bool true adds proficiency', pv.get('stealth'), 2 + 3);   // dex_mod 2 + prof 3
eq('bool false omits proficiency', pv.get('acrobatics'), 2);   // dex_mod 2 + 0
eq('bool resolves to 1', computeAll([{ id: 'b', kind: 'bool', value: true }, { id: 'a', kind: 'calc', formula: 'b + 4' }]).results.get('a'), 5);
eq('bool resolves to 0', computeAll([{ id: 'b', kind: 'bool', value: false }, { id: 'a', kind: 'calc', formula: 'b + 4' }]).results.get('a'), 4);

// dice rejected in calc
let threw = false;
try { compileCalc('1d20 + 3'); } catch (e) { threw = e instanceof FormulaError; }
ok('calc rejects dice', threw);

// cycle -> ERR for all members
const cyc = computeAll([
  { id: 'a', kind: 'calc', formula: 'b + 1' },
  { id: 'b', kind: 'calc', formula: 'a + 1' },
]);
eq('cycle a', cyc.results.get('a'), 'ERR');
eq('cycle b', cyc.results.get('b'), 'ERR');

// unknown ref -> ERR
const unk = computeAll([{ id: 'a', kind: 'calc', formula: 'nonexistent + 1' }]);
eq('unknown ref', unk.results.get('a'), 'ERR');

// parse error -> ERR, no throw
const bad = computeAll([{ id: 'a', kind: 'calc', formula: '1 + + 2' }]);
eq('parse error', bad.results.get('a'), 'ERR');

// roll: deterministic RNG for assertions
function seq(nums) { let i = 0; return () => nums[i++ % nums.length]; }
const resolve = (name) => ({ str_mod: 3, dex_mod: 2 }[name] ?? 0);
// rng 0.65 * 20 = 13, +1 = 14
const r = evalRoll('1d20 + str_mod', resolve, seq([0.65]));
eq('roll total', r.total, 17);
eq('roll display', r.display, '1d20 (14) + str_mod (3) = 17');
eq('roll parts', r.parts, [{ label: '1d20', rolls: [14], value: 14 }, { label: 'str_mod', value: 3 }]);

// 2d6: 0.0->1, 0.99->6  => 7
const r2 = evalRoll('2d6 + 3', resolve, seq([0.0, 0.999]));
eq('2d6 total', r2.total, 10);

// keep-highest advantage: 2d20kh1, rolls 5 and 18 -> 18
const adv = evalRoll('2d20kh1 + dex_mod', resolve, seq([0.2, 0.88])); // ~5, ~18
ok('advantage kh', adv.total === 18 + 2);

// previewRoll — face summary (dice notation + flat modifier)
const pr = (name) => ({ str_mod: 3, dex_mod: 2, proficiency_bonus: 2 }[name] ?? 0);
eq('preview attack', previewRoll('1d20 + str_mod + proficiency_bonus', pr), '1d20 + 5');
eq('preview damage', previewRoll('1d8 + str_mod', pr), '1d8 + 3');
eq('preview flat zero', previewRoll('1d6 + dex_mod', (n) => (n === 'dex_mod' ? 0 : 0)), '1d6');
eq('preview negative', previewRoll('1d4 + str_mod', () => -1), '1d4 − 1');
eq('preview multi-dice', previewRoll('2d6 + 1d4 + 2', pr), '2d6 + 1d4 + 2');
eq('preview no dice', previewRoll('str_mod + 1', pr), '4');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
