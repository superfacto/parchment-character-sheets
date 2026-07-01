// Parchment engine — the two-context math kernel (SPEC §6).
// Tokenizer -> shunting-yard -> RPN evaluator. No eval(), ever.
//
// Two contexts share one grammar; the roll context adds the NdM dice primitive.
// Calc formulas MUST NOT contain dice (that would let randomness into the
// deterministic dependency graph). The tokenizer flags dice tokens; the calc
// path rejects them at parse time.

export class FormulaError extends Error {}

const FUNCTIONS = {
  floor: { arity: 1, fn: (a) => Math.floor(a) },
  ceil:  { arity: 1, fn: (a) => Math.ceil(a) },
  round: { arity: 1, fn: (a) => Math.round(a) },
  abs:   { arity: 1, fn: (a) => Math.abs(a) },
  sign:  { arity: 1, fn: (a) => Math.sign(a) },
  min:   { arity: 'var', fn: (...xs) => Math.min(...xs) },
  max:   { arity: 'var', fn: (...xs) => Math.max(...xs) },
  clamp: { arity: 3, fn: (x, lo, hi) => Math.min(Math.max(x, lo), hi) },
};

const OPS = {
  '+': { prec: 2, assoc: 'L', fn: (a, b) => a + b },
  '-': { prec: 2, assoc: 'L', fn: (a, b) => a - b },
  '*': { prec: 3, assoc: 'L', fn: (a, b) => a * b },
  '/': { prec: 3, assoc: 'L', fn: (a, b) => (b === 0 ? 0 : a / b) },
  '%': { prec: 3, assoc: 'L', fn: (a, b) => (b === 0 ? 0 : a % b) },
};

// --- Tokenizer -------------------------------------------------------------
// Token kinds: number, ref, func, op, lparen, rparen, comma, dice, uminus
export function tokenize(src, { allowDice } = { allowDice: false }) {
  const tokens = [];
  let i = 0;
  const s = src;
  const isDigit = (c) => c >= '0' && c <= '9';
  const isIdentStart = (c) => /[a-z]/i.test(c) || c === '_';
  const isIdentPart = (c) => /[a-z0-9_]/i.test(c);

  while (i < s.length) {
    const c = s[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }

    if (isDigit(c) || (c === '.' && isDigit(s[i + 1]))) {
      let j = i;
      while (j < s.length && (isDigit(s[j]) || s[j] === '.')) j++;
      // A leading integer may be a dice literal: NdM(kh|kl)K
      if (allowDice && s[j] === 'd' && isDigit(s[j + 1])) {
        let k = j + 1;
        while (k < s.length && isDigit(s[k])) k++;
        let keep = null;
        if (s[k] === 'k' && (s[k + 1] === 'h' || s[k + 1] === 'l')) {
          const kind = s[k + 1] === 'h' ? 'kh' : 'kl';
          let m = k + 2;
          while (m < s.length && isDigit(s[m])) m++;
          keep = { kind, n: parseInt(s.slice(k + 2, m) || '1', 10) };
          k = m;
        }
        const count = parseInt(s.slice(i, j), 10);
        const sides = parseInt(s.slice(j + 1, keep ? s.indexOf('k', j) : k), 10);
        tokens.push({ type: 'dice', text: s.slice(i, k), count, sides, keep });
        i = k;
        continue;
      }
      const text = s.slice(i, j);
      if (text.split('.').length > 2) throw new FormulaError(`Bad number "${text}"`);
      tokens.push({ type: 'number', value: parseFloat(text), text });
      i = j;
      continue;
    }

    if (isIdentStart(c)) {
      let j = i;
      while (j < s.length && isIdentPart(s[j])) j++;
      const word = s.slice(i, j);
      // A "d" glued to digits was handled above; a bare identifier like "d20"
      // is just a ref. Functions are recognised by a following '('.
      if (FUNCTIONS[word] && s[j] === '(') {
        tokens.push({ type: 'func', name: word });
      } else {
        tokens.push({ type: 'ref', name: word, text: word });
      }
      i = j;
      continue;
    }

    if (c === '(') { tokens.push({ type: 'lparen' }); i++; continue; }
    if (c === ')') { tokens.push({ type: 'rparen' }); i++; continue; }
    if (c === ',') { tokens.push({ type: 'comma' }); i++; continue; }

    if (OPS[c]) {
      // Unary minus: '-' at start, or after an operator / '(' / ','.
      const prev = tokens[tokens.length - 1];
      const unary = c === '-' && (!prev || prev.type === 'op' || prev.type === 'uminus' ||
        prev.type === 'lparen' || prev.type === 'comma' || prev.type === 'func');
      tokens.push(unary ? { type: 'uminus' } : { type: 'op', op: c });
      i++;
      continue;
    }

    throw new FormulaError(`Unexpected character "${c}"`);
  }
  return tokens;
}

// --- Shunting-yard: tokens -> RPN -----------------------------------------
export function toRPN(tokens) {
  const out = [];
  const stack = [];
  const argc = []; // argument counters for functions

  for (const t of tokens) {
    switch (t.type) {
      case 'number':
      case 'ref':
      case 'dice':
        out.push(t);
        break;
      case 'func':
        stack.push(t);
        argc.push(1);
        break;
      case 'comma':
        while (stack.length && stack[stack.length - 1].type !== 'lparen') out.push(stack.pop());
        if (!stack.length) throw new FormulaError('Misplaced comma');
        argc[argc.length - 1]++;
        break;
      case 'uminus':
        stack.push(t); // treated like a right-assoc high-prec unary op
        break;
      case 'op': {
        const o1 = OPS[t.op];
        while (stack.length) {
          const top = stack[stack.length - 1];
          if (top.type === 'uminus') { out.push(stack.pop()); continue; }
          if (top.type === 'op') {
            const o2 = OPS[top.op];
            if (o2.prec > o1.prec || (o2.prec === o1.prec && o1.assoc === 'L')) {
              out.push(stack.pop());
              continue;
            }
          }
          break;
        }
        stack.push(t);
        break;
      }
      case 'lparen':
        stack.push(t);
        break;
      case 'rparen': {
        while (stack.length && stack[stack.length - 1].type !== 'lparen') out.push(stack.pop());
        if (!stack.length) throw new FormulaError('Mismatched parenthesis');
        stack.pop(); // discard lparen
        if (stack.length && stack[stack.length - 1].type === 'func') {
          const fn = stack.pop();
          fn.nargs = argc.pop();
          out.push(fn);
        }
        break;
      }
      default:
        throw new FormulaError(`Unknown token ${t.type}`);
    }
  }
  while (stack.length) {
    const top = stack.pop();
    if (top.type === 'lparen' || top.type === 'rparen') throw new FormulaError('Mismatched parenthesis');
    out.push(top);
  }
  return out;
}

// --- RPN evaluator ---------------------------------------------------------
// resolve(name) -> number, or throws FormulaError for unknown refs.
// rollDice(token) -> { value, rolls } used only in the roll context.
function evalRPN(rpn, { resolve, rollDice, onLeaf }) {
  const st = [];
  for (const t of rpn) {
    switch (t.type) {
      case 'number':
        st.push(t.value);
        break;
      case 'ref': {
        const v = resolve(t.name);
        if (onLeaf) onLeaf({ label: t.name, value: v });
        st.push(v);
        break;
      }
      case 'dice': {
        if (!rollDice) throw new FormulaError('Dice not allowed here');
        const { value, rolls } = rollDice(t);
        if (onLeaf) onLeaf({ label: t.text, rolls, value });
        st.push(value);
        break;
      }
      case 'uminus':
        if (st.length < 1) throw new FormulaError('Bad expression');
        st.push(-st.pop());
        break;
      case 'op': {
        if (st.length < 2) throw new FormulaError('Bad expression');
        const b = st.pop(); const a = st.pop();
        st.push(OPS[t.op].fn(a, b));
        break;
      }
      case 'func': {
        const spec = FUNCTIONS[t.name];
        const n = spec.arity === 'var' ? t.nargs : spec.arity;
        if (spec.arity !== 'var' && t.nargs !== spec.arity)
          throw new FormulaError(`${t.name}() expects ${spec.arity} args`);
        if (st.length < n) throw new FormulaError('Bad expression');
        const args = st.splice(st.length - n, n);
        st.push(spec.fn(...args));
        break;
      }
      default:
        throw new FormulaError(`Cannot evaluate ${t.type}`);
    }
  }
  if (st.length !== 1) throw new FormulaError('Bad expression');
  return st[0];
}

function rollDice(t, rng = Math.random) {
  const rolls = [];
  for (let k = 0; k < t.count; k++) rolls.push(1 + Math.floor(rng() * t.sides));
  let kept = rolls;
  if (t.keep) {
    const sorted = [...rolls].sort((a, b) => a - b);
    kept = t.keep.kind === 'kh' ? sorted.slice(sorted.length - t.keep.n) : sorted.slice(0, t.keep.n);
  }
  return { value: kept.reduce((a, b) => a + b, 0), rolls };
}

// Extract the value-id refs a formula depends on (for the dependency graph).
export function refsOf(formula) {
  const tokens = tokenize(formula, { allowDice: false });
  const set = new Set();
  for (const t of tokens) if (t.type === 'ref') set.add(t.name);
  return [...set];
}

// Compile a calc formula. Throws FormulaError (incl. on any dice token).
export function compileCalc(formula) {
  // Tokenize WITH dice recognition so an NdM literal is caught and rejected —
  // the grammar wall (SPEC §6) forbids randomness in the deterministic graph.
  if (tokenize(formula, { allowDice: true }).some((t) => t.type === 'dice'))
    throw new FormulaError('Dice not allowed in a formula');
  return toRPN(tokenize(formula, { allowDice: false }));
}

// Evaluate a calc RPN. resolve(name) supplies dependency values.
export function evalCalc(rpn, resolve) {
  return evalRPN(rpn, { resolve });
}

// Evaluate a roll expression -> structured breakdown (SPEC §6.4).
export function evalRoll(expr, resolve, rng = Math.random) {
  const rpn = toRPN(tokenize(expr, { allowDice: true }));
  const parts = [];
  const total = evalRPN(rpn, {
    resolve,
    rollDice: (t) => rollDice(t, rng),
    onLeaf: (p) => parts.push(p),
  });
  return { total, parts, display: renderRoll(parts, total) };
}

function renderRoll(parts, total) {
  const segs = parts.map((p) =>
    p.rolls ? `${p.label} (${p.rolls.join('+')})` : `${p.label} (${p.value})`
  );
  return `${segs.join(' + ')} = ${total}`;
}

// A static, auto-updating summary of a roll for a widget face, e.g. "1d20 + 5"
// or "1d8 + 3". The dice notation is kept literal; the non-dice terms are
// evaluated (dice treated as 0) into a single flat modifier via `resolve`.
export function previewRoll(expr, resolve) {
  let tokens;
  try { tokens = tokenize(expr, { allowDice: true }); } catch { return '?'; }
  const dice = tokens.filter((t) => t.type === 'dice').map((t) => t.text);
  let flat = NaN;
  try { flat = evalRPN(toRPN(tokens), { resolve, rollDice: () => ({ value: 0, rolls: [] }) }); } catch { flat = NaN; }
  if (!dice.length) return Number.isFinite(flat) ? String(flat) : '?';
  const dicePart = dice.join(' + ');
  if (!Number.isFinite(flat) || flat === 0) return dicePart;
  return `${dicePart} ${flat > 0 ? '+' : '−'} ${Math.abs(flat)}`;
}

// --- Character graph: compute all calc values (topo sort + cycle detect) ---
// values: array of Value objects. Returns Map(id -> number|string|'ERR')
// plus a details map for tap-detail (formula / error message).
export function computeAll(values) {
  const byId = new Map(values.map((v) => [v.id, v]));
  const results = new Map();
  const details = new Map(); // id -> { formula?, error? , breakdown? }
  const compiled = new Map();

  // Seed literal (number/bool/text) values. A boolean resolves to 1/0 so it can
  // multiply into arithmetic (e.g. proficient * proficiency_bonus).
  for (const v of values) {
    if (v.kind === 'number') results.set(v.id, typeof v.value === 'number' ? v.value : 0);
    else if (v.kind === 'bool') results.set(v.id, v.value ? 1 : 0);
    else if (v.kind === 'text') results.set(v.id, v.text ?? '');
  }

  // Precompile calc formulas; a parse error is a per-value ERR.
  const deps = new Map();
  for (const v of values) {
    if (v.kind !== 'calc') continue;
    try {
      compiled.set(v.id, compileCalc(v.formula || ''));
      deps.set(v.id, refsOf(v.formula || ''));
    } catch (e) {
      results.set(v.id, 'ERR');
      details.set(v.id, { error: e.message });
    }
  }

  // Cycle detection via DFS colouring, over calc nodes only.
  const state = new Map(); // white(undef)/gray(1)/black(2)
  const inCycle = new Set();
  function visit(id, stack) {
    if (state.get(id) === 2) return;
    if (state.get(id) === 1) {
      // Found a back-edge: everything from the first occurrence is a cycle.
      const from = stack.indexOf(id);
      for (const n of stack.slice(from)) inCycle.add(n);
      return;
    }
    if (!byId.get(id) || byId.get(id).kind !== 'calc') return; // leaf ref
    if (!compiled.has(id)) return; // parse-errored node
    state.set(id, 1);
    stack.push(id);
    for (const d of deps.get(id) || []) visit(d, stack);
    stack.pop();
    state.set(id, 2);
  }
  for (const id of compiled.keys()) if (!state.has(id)) visit(id, []);

  for (const id of inCycle) {
    results.set(id, 'ERR');
    details.set(id, { error: `Cycle: ${id} depends on itself` });
  }

  // Evaluate remaining calc nodes in dependency order (memoised recursion).
  function evalNode(id) {
    if (results.has(id)) return results.get(id);
    const v = byId.get(id);
    if (!v) { results.set(id, 'ERR'); details.set(id, { error: `Unknown value "${id}"` }); return 'ERR'; }
    if (v.kind !== 'calc') { const r = results.get(id) ?? 0; return r; }
    if (!compiled.has(id)) return 'ERR';
    try {
      const val = evalCalc(compiled.get(id), (name) => {
        const r = evalNode(name);
        if (r === 'ERR' || typeof r !== 'number') throw new FormulaError(`Bad ref "${name}"`);
        return r;
      });
      results.set(id, val);
      details.set(id, { formula: v.formula });
      return val;
    } catch (e) {
      results.set(id, 'ERR');
      details.set(id, { error: e.message });
      return 'ERR';
    }
  }
  for (const id of compiled.keys()) if (!inCycle.has(id)) evalNode(id);

  return { results, details };
}

export const _internal = { rollDice, evalRPN };
