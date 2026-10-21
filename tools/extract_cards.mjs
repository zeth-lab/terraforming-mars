#!/usr/bin/env node
// Extracts structured card data (names, costs, tags, requirements, victory points,
// and an ordered list of "symbol atoms") for every base-game + Corporate Era
// project card (208) and corporation card (13) of Terraforming Mars, in Korean
// and English, from the open-source rules-engine implementation at
// https://github.com/terraforming-mars/terraforming-mars (GPL-3.0).
//
// This script does NOT copy any of that project's game logic or rendering code.
// It only reads data out of card definition files using the TypeScript compiler's
// parser (to build an AST) and simple regex-based parsing of small enum/locale
// files, then re-expresses that data in this project's own schema (see
// data/README.md for the schema and data/atoms.md for the "atom" vocabulary).
//
// Usage:
//   node tools/extract_cards.mjs --src <path-to-cloned-terraforming-mars-repo> [--out <dir>]
//
// See data/README.md for how to obtain <path-to-cloned-terraforming-mars-repo>
// via a sparse git checkout, and for the full re-run instructions.

import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const out = {src: null, out: path.join(__dirname, '..', 'data')};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--src') out.src = argv[++i];
    else if (argv[i] === '--out') out.out = argv[++i];
  }
  return out;
}

const ARGS = parseArgs(process.argv.slice(2));
if (!ARGS.src) {
  console.error('Usage: node tools/extract_cards.mjs --src <path-to-cloned-terraforming-mars-repo> [--out <dir>]');
  console.error('See data/README.md for how to obtain the source checkout.');
  process.exit(1);
}
const SRC_ROOT = path.resolve(ARGS.src);
const OUT_DIR = path.resolve(ARGS.out);

function readSrc(rel) {
  return fs.readFileSync(path.join(SRC_ROOT, rel), 'utf8');
}

// ---------------------------------------------------------------------------
// Enum / const-object maps, parsed from the upstream source (not hardcoded)
// ---------------------------------------------------------------------------

function parseConstObjectOrEnum(text, blockStartRe) {
  // Finds `export enum X { KEY = 'value', ... }` or `export const X = { KEY: 'value', ... }`
  const m = blockStartRe.exec(text);
  if (!m) throw new Error('enum/const block not found for ' + blockStartRe);
  const start = text.indexOf('{', m.index);
  let depth = 0, i = start;
  for (; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') { depth--; if (depth === 0) break; }
  }
  const body = text.slice(start + 1, i);
  const map = {};
  const lineRe = /([A-Z0-9_]+)\s*[=:]\s*'((?:[^'\\]|\\.)*)'/g;
  let lm;
  while ((lm = lineRe.exec(body)) !== null) {
    map[lm[1]] = lm[2].replace(/\\'/g, "'").replace(/\\\\/g, '\\');
  }
  return map;
}

function buildEnumMaps() {
  const Tag = parseConstObjectOrEnum(readSrc('src/common/cards/Tag.ts'), /export enum Tag/);
  const CardType = parseConstObjectOrEnum(readSrc('src/common/cards/CardType.ts'), /export enum CardType/);
  const CardResource = parseConstObjectOrEnum(readSrc('src/common/CardResource.ts'), /export enum CardResource/);
  const Resource = parseConstObjectOrEnum(readSrc('src/common/Resource.ts'), /export const Resource/);
  const GlobalParameter = parseConstObjectOrEnum(readSrc('src/common/GlobalParameter.ts'), /export const GlobalParameter/);
  const CardName = parseConstObjectOrEnum(readSrc('src/common/cards/CardName.ts'), /export enum CardName/);

  // TileType is a numeric enum; we only need member-name -> our own lowercase label.
  const tileTypeText = readSrc('src/common/TileType.ts');
  const tileBlockStart = tileTypeText.indexOf('export enum TileType');
  const braceStart = tileTypeText.indexOf('{', tileBlockStart);
  let depth = 0, i = braceStart;
  for (; i < tileTypeText.length; i++) {
    if (tileTypeText[i] === '{') depth++;
    else if (tileTypeText[i] === '}') { depth--; if (depth === 0) break; }
  }
  const tileBody = tileTypeText.slice(braceStart + 1, i);
  const TileType = {};
  for (const line of tileBody.split('\n')) {
    const mm = /^\s*([A-Z0-9_]+)\s*,/.exec(line);
    if (mm) TileType[mm[1]] = mm[1].toLowerCase();
  }

  // Size only affects icon pixel size, irrelevant to our atom vocabulary; stub it
  // out so Size.SMALL/.MEDIUM/... resolve instead of triggering an "unresolved" flag.
  const Size = {TINY: 'tiny', SMALL: 'small', MEDIUM: 'medium', LARGE: 'large'};

  return {Tag, CardType, CardResource, Resource, GlobalParameter, CardName, TileType, Size};
}

// ---------------------------------------------------------------------------
// Manifest parsing: which cards exist, which module (base/corpera), which kind
// (project/corporation), and which file implements each one.
// ---------------------------------------------------------------------------

function parseManifests() {
  const text = readSrc('src/server/cards/StandardCardManifests.ts');

  const importMap = {};
  const importRe = /import\s*\{([^}]+)\}\s*from\s*'(\.\/[^']+)';/g;
  let im;
  while ((im = importRe.exec(text)) !== null) {
    const names = im[1].split(',').map((s) => s.trim()).filter(Boolean);
    const relPath = im[2].replace(/^\.\//, '');
    for (const n of names) {
      const parts = n.split(/\s+as\s+/);
      const localName = parts[parts.length - 1].trim();
      importMap[localName] = relPath;
    }
  }

  const baseStart = text.indexOf('BASE_CARD_MANIFEST');
  const corpEraStart = text.indexOf('CORP_ERA_CARD_MANIFEST');
  const baseSection = text.slice(baseStart, corpEraStart);
  const corpEraSection = text.slice(corpEraStart);

  function sub(s, a, b) {
    const ia = s.indexOf(a);
    const ib = b ? s.indexOf(b, ia) : s.length;
    return s.slice(ia, ib < 0 ? s.length : ib);
  }

  function extractEntries(sectionText) {
    const entries = [];
    const entryRe = /\[CardName\.([A-Z0-9_]+)\]:\s*\{Factory:\s*([A-Za-z0-9_]+)\}/g;
    let em;
    while ((em = entryRe.exec(sectionText)) !== null) {
      entries.push({cardNameKey: em[1], className: em[2]});
    }
    return entries;
  }

  const baseProjRaw = sub(baseSection, 'projectCards:', 'corporationCards:');
  const baseCorpRaw = sub(baseSection, 'corporationCards:', 'standardProjects:');
  const ceProjRaw = sub(corpEraSection, 'projectCards:', 'corporationCards:');
  const ceCorpRaw = sub(corpEraSection, 'corporationCards:', null);

  const records = [];
  for (const e of extractEntries(baseProjRaw)) records.push({...e, module: 'base', kind: 'project'});
  for (const e of extractEntries(baseCorpRaw)) records.push({...e, module: 'base', kind: 'corporation'});
  for (const e of extractEntries(ceProjRaw)) records.push({...e, module: 'corpera', kind: 'project'});
  for (const e of extractEntries(ceCorpRaw)) records.push({...e, module: 'corpera', kind: 'corporation'});

  for (const r of records) {
    const rel = importMap[r.className];
    r.filePath = rel ? path.join(SRC_ROOT, 'src/server/cards', rel + '.ts') : null;
  }

  return records;
}

// ---------------------------------------------------------------------------
// AST evaluation of the object literal passed to `super({...})` in a card's
// constructor: literals, arrays, nested objects, and enum member access
// (Tag.X, CardType.X, Resource.X, ...) are resolved to plain JS values.
// Anything we can't confidently resolve becomes a `{__unresolved}` marker and
// is recorded as a warning, which in turn sets needs_manual on that card.
// ---------------------------------------------------------------------------

const OPTIONS_CONSTANTS = { // from server/cards/Options.ts
  all: true, clone: true, digit: true, max: true, nextTo: true,
  cancelled: true, uppercase: true, inParens: true,
};
const SOFT_IGNORE_NAMESPACES = new Set(['SpaceName', 'SpaceId']); // board-space ids; irrelevant to our schema

function mark(text, kind) { return {__unresolved: true, text, kind}; }

let CURRENT_LOCAL_DEFAULTS = {};
function setLocalDefaults(d) { CURRENT_LOCAL_DEFAULTS = d || {}; }

function resolveFreeIdentifier(name, warnings, filePath, maps) {
  if (name === 'undefined') return undefined;
  if (Object.prototype.hasOwnProperty.call(OPTIONS_CONSTANTS, name)) return OPTIONS_CONSTANTS[name];
  if (Object.prototype.hasOwnProperty.call(CURRENT_LOCAL_DEFAULTS, name)) {
    const defNode = CURRENT_LOCAL_DEFAULTS[name];
    if (defNode === null) return undefined;
    return evalData(defNode, maps, warnings, filePath);
  }
  warnings.push({file: filePath, text: name, kind: 'unresolved-identifier'});
  return mark(name, 'unresolved-identifier');
}

function propKey(nameNode, maps, warnings, filePath) {
  if (ts.isIdentifier(nameNode)) return nameNode.text;
  if (ts.isStringLiteral(nameNode)) return nameNode.text;
  if (ts.isComputedPropertyName(nameNode)) {
    const v = evalData(nameNode.expression, maps, warnings, filePath);
    return typeof v === 'string' ? v : String(v);
  }
  return nameNode.getText();
}

// metadata.renderData / metadata.victoryPoints / metadata.helpText are either
// handled separately (renderData) or are display-only duplicates we don't need
// (victoryPoints/helpText) — skip them here rather than fight their shapes.
function evalMetadataNode(node, maps, warnings, filePath) {
  if (!ts.isObjectLiteralExpression(node)) return evalData(node, maps, warnings, filePath);
  const out = {};
  for (const mp of node.properties) {
    if (!ts.isPropertyAssignment(mp)) continue;
    const key = propKey(mp.name, maps, warnings, filePath);
    if (key === 'cardNumber' || key === 'description') {
      out[key] = evalData(mp.initializer, maps, warnings, filePath);
    }
  }
  return out;
}

function evalData(node, maps, warnings, filePath) {
  const k = node.kind;
  const T = ts.SyntaxKind;
  if (k === T.StringLiteral || k === T.NoSubstitutionTemplateLiteral) return node.text;
  if (k === T.NumericLiteral) return Number(node.text);
  if (k === T.TrueKeyword) return true;
  if (k === T.FalseKeyword) return false;
  if (k === T.UndefinedKeyword) return undefined;
  if (k === T.PrefixUnaryExpression && node.operator === T.MinusToken) {
    const inner = evalData(node.operand, maps, warnings, filePath);
    return typeof inner === 'number' ? -inner : inner;
  }
  if (k === T.ParenthesizedExpression) return evalData(node.expression, maps, warnings, filePath);
  if (k === T.ArrayLiteralExpression) {
    return node.elements.map((el) => evalData(el, maps, warnings, filePath));
  }
  if (k === T.ObjectLiteralExpression) {
    const obj = {};
    for (const prop of node.properties) {
      if (ts.isPropertyAssignment(prop)) {
        const key = propKey(prop.name, maps, warnings, filePath);
        obj[key] = key === 'metadata'
          ? evalMetadataNode(prop.initializer, maps, warnings, filePath)
          : evalData(prop.initializer, maps, warnings, filePath);
      } else if (ts.isShorthandPropertyAssignment(prop)) {
        const key = prop.name.text;
        if (key === 'metadata' && CURRENT_LOCAL_DEFAULTS[key] && ts.isObjectLiteralExpression(CURRENT_LOCAL_DEFAULTS[key])) {
          obj[key] = evalMetadataNode(CURRENT_LOCAL_DEFAULTS[key], maps, warnings, filePath);
        } else {
          obj[key] = resolveFreeIdentifier(key, warnings, filePath, maps);
        }
      } else if (ts.isSpreadAssignment(prop)) {
        const spread = evalData(prop.expression, maps, warnings, filePath);
        if (spread && typeof spread === 'object') Object.assign(obj, spread);
      } else {
        warnings.push({file: filePath, text: prop.getText(), kind: 'unknown-object-prop'});
      }
    }
    return obj;
  }
  if (k === T.PropertyAccessExpression) {
    const objName = node.expression.getText();
    const memberName = node.name.text;
    if (maps[objName] && maps[objName][memberName] !== undefined) return maps[objName][memberName];
    if (SOFT_IGNORE_NAMESPACES.has(objName)) return node.getText();
    warnings.push({file: filePath, text: node.getText(), kind: 'unresolved-enum'});
    return mark(node.getText(), 'unresolved-enum');
  }
  if (k === T.Identifier) return resolveFreeIdentifier(node.text, warnings, filePath, maps);
  if (k === T.CallExpression) {
    warnings.push({file: filePath, text: node.getText().slice(0, 200), kind: 'unexpected-call'});
    return mark(node.getText().slice(0, 300), 'unexpected-call');
  }
  warnings.push({file: filePath, text: node.getText().slice(0, 200), kind: 'unhandled-node:' + T[k]});
  return mark(node.getText().slice(0, 300), 'unhandled-node');
}

// Locate the class, its constructor, and its `super({...})` call.
function parseCardFile(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const sourceFile = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let ctorNode = null;
  let superCallNode = null;

  function visit(node) {
    if (ts.isConstructorDeclaration(node) && !ctorNode) {
      ctorNode = node;
      if (node.body) {
        for (const stmt of node.body.statements) {
          if (ts.isExpressionStatement(stmt) && ts.isCallExpression(stmt.expression) &&
              stmt.expression.expression.kind === ts.SyntaxKind.SuperKeyword) {
            superCallNode = stmt.expression;
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);

  const paramDefaults = {};
  if (ctorNode) {
    for (const p of ctorNode.parameters) {
      if (ts.isIdentifier(p.name)) paramDefaults[p.name.text] = p.initializer ?? null;
    }
  }

  return {superCallNode, paramDefaults};
}

// ---------------------------------------------------------------------------
// renderData builder-chain interpreter.
//
// Rather than executing (or re-implementing) the upstream CardRenderer class,
// we statically flatten the fluent method-chain AST — `b.production(pb =>
// pb.steel(1))`, `b.effect('...', eb => eb.tag(X).startEffect.cards(1))`, etc.
// — into an ordered list of {method, args} calls. This reads off the exact
// sequence of icons shown on the physical card without importing or copying
// any of that class's logic.
// ---------------------------------------------------------------------------

function flattenChain(node, paramName, maps, warnings, filePath, out) {
  if (ts.isCallExpression(node)) {
    const callee = node.expression;
    if (ts.isPropertyAccessExpression(callee)) {
      flattenChain(callee.expression, paramName, maps, warnings, filePath, out);
      const args = node.arguments.map((a) => evalBuilderArg(a, paramName, maps, warnings, filePath));
      out.push({method: callee.name.text, args, getter: false});
    } else {
      warnings.push({file: filePath, text: node.getText().slice(0, 200), kind: 'chain-unexpected-callee'});
    }
    return;
  }
  if (ts.isPropertyAccessExpression(node)) {
    flattenChain(node.expression, paramName, maps, warnings, filePath, out);
    out.push({method: node.name.text, args: [], getter: true});
    return;
  }
  if (ts.isParenthesizedExpression(node)) {
    flattenChain(node.expression, paramName, maps, warnings, filePath, out);
    return;
  }
  if (ts.isIdentifier(node) && node.text === paramName) return; // root of chain
  warnings.push({file: filePath, text: node.getText().slice(0, 200), kind: 'chain-unexpected-base'});
}

function evalBuilderArg(node, paramName, maps, warnings, filePath) {
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
    const innerParam = node.parameters[0] ? node.parameters[0].name.getText() : null;
    const statements = interpretArrowBody(node, innerParam, maps, warnings, filePath);
    return {__builderFn: true, param: innerParam, statements};
  }
  return evalData(node, maps, warnings, filePath);
}

function interpretArrowBody(arrowNode, paramName, maps, warnings, filePath) {
  const body = arrowNode.body;
  if (ts.isBlock(body)) {
    const stmts = [];
    for (const s of body.statements) {
      if (ts.isExpressionStatement(s)) {
        const out = [];
        flattenChain(s.expression, paramName, maps, warnings, filePath, out);
        stmts.push(out);
      } else {
        warnings.push({file: filePath, text: s.getText().slice(0, 150), kind: 'renderdata-unhandled-statement'});
      }
    }
    return stmts;
  }
  const out = [];
  flattenChain(body, paramName, maps, warnings, filePath, out);
  return [out];
}

function interpretRenderData(callExprNode, maps, warnings, filePath) {
  if (!callExprNode || !ts.isCallExpression(callExprNode)) return null;
  const fnArg = callExprNode.arguments[0];
  if (!fnArg || !(ts.isArrowFunction(fnArg) || ts.isFunctionExpression(fnArg))) return null;
  const paramName = fnArg.parameters[0] ? fnArg.parameters[0].name.getText() : null;
  return interpretArrowBody(fnArg, paramName, maps, warnings, filePath);
}

function findRenderDataCall(node) {
  let found = null;
  function visit(n) {
    if (found) return;
    if (ts.isCallExpression(n) && n.expression.getText() === 'CardRenderer.builder') { found = n; return; }
    ts.forEachChild(n, visit);
  }
  visit(node);
  return found;
}

// ---------------------------------------------------------------------------
// renderData ops -> our "atom" vocabulary (see data/atoms.md)
// ---------------------------------------------------------------------------

const SYMBOL_IGNORE = new Set([
  'br', 'nbsp', 'arrow', 'plus', 'minus', 'slash', 'colon', 'equals', 'or', 'asterix',
  'empty', 'vSpace', 'surveyMission', 'startEffect', 'startAction', 'description',
  'vpText', 'adjacencyBonus', 'projectRequirements',
]);
const PROD_RESOURCES = new Set(['steel', 'titanium', 'plants', 'energy', 'heat', 'megacredits']);
const GLOBAL_PARAMS = new Set(['temperature', 'oxygen', 'venus']);

function resName(name) { return name === 'megacredits' ? 'mc' : name; }
function optionsAll(opt) { return !!(opt && typeof opt === 'object' && opt.all === true); }

function makeCtx({translate, flagManual}) {
  return {translate, flagManual, texts: []};
}

function convertStatementsToAtoms(statements, ctx) {
  const out = [];
  for (const ops of statements || []) out.push(...convertOpsToAtoms(ops, ctx));
  return out;
}

// Some cards write `.minus().megacredits(2)` instead of `.megacredits(-2)` — the live
// renderer auto-detects a negative `amount` and prepends a minus symbol itself, but
// some card source negates "by hand" with an explicit `.minus()` call first. Fold
// that into a negative amount on the following numeric op so both forms agree.
function foldMinusSigns(ops) {
  const out = [];
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    const next = ops[i + 1];
    if (op.method === 'minus' && next && typeof next.args[0] === 'number') {
      out.push({...next, args: [-next.args[0], ...next.args.slice(1)]});
      i++;
      continue;
    }
    out.push(op);
  }
  return out;
}

// Pattern `<amount icon>.slash().tag(X)` / `.city(...)` / `.resource(...)` means
// "this amount, once per X" (e.g. "+1 plant production per plant tag").
function tryAttachPerModifier(ops, i, atom) {
  const next1 = ops[i + 1];
  const next2 = ops[i + 2];
  if (!next1 || next1.method !== 'slash' || !next2) return 0;
  if (next2.method === 'tag') { atom.per = {tag: next2.args[0]}; return 2; }
  if (next2.method === 'city' || next2.method === 'cities') { atom.per = {tile: 'city'}; return 2; }
  if (next2.method === 'resource') { atom.per = {card_res: String(next2.args[0]).toLowerCase()}; return 2; }
  return 0;
}

function convertOpsToAtoms(rawOps, ctx) {
  const ops = foldMinusSigns(rawOps);
  const atoms = [];
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    const {method, args} = op;
    if (SYMBOL_IGNORE.has(method)) continue;

    if (method === 'production') {
      const fnArg = args[0];
      // Multiple `pb.x();` statements in one production() callback are usually one
      // composite line (e.g. "mc / per city tile"), split only for source readability.
      const innerOps = foldMinusSigns(((fnArg && fnArg.statements) || []).flat());
      for (let j = 0; j < innerOps.length; j++) {
        const innerOp = innerOps[j];
        if (SYMBOL_IGNORE.has(innerOp.method)) continue;
        if (PROD_RESOURCES.has(innerOp.method)) {
          const atom = {atom: 'prod', res: resName(innerOp.method), n: innerOp.args[0], any: optionsAll(innerOp.args[1])};
          j += tryAttachPerModifier(innerOps, j, atom);
          atoms.push(atom);
        } else if (innerOp.method === 'text' || innerOp.method === 'plainText' || innerOp.method === 'plate') {
          const s = innerOp.args[0];
          if (typeof s === 'string' && s.length > 0) {
            const ko = ctx.translate(s);
            atoms.push({atom: 'text', en: s, ko});
            ctx.texts.push({en: s, ko});
          }
        } else {
          ctx.flagManual('unmapped-production-method:' + innerOp.method);
          atoms.push({atom: 'text', en: 'production.' + innerOp.method});
        }
      }
      continue;
    }

    if (PROD_RESOURCES.has(method)) {
      const atom = {atom: 'gain', res: resName(method), n: args[0], any: optionsAll(args[1])};
      i += tryAttachPerModifier(ops, i, atom);
      atoms.push(atom);
      continue;
    }
    if (method === 'tr') {
      const atom = {atom: 'tr', n: args[0]};
      i += tryAttachPerModifier(ops, i, atom);
      atoms.push(atom);
      continue;
    }
    if (GLOBAL_PARAMS.has(method)) {
      const atom = {atom: 'global', param: method, n: args[0]};
      i += tryAttachPerModifier(ops, i, atom);
      atoms.push(atom);
      continue;
    }
    if (method === 'oceans') { atoms.push({atom: 'tile', tile: 'ocean', n: args[0]}); continue; }
    if (method === 'cards') {
      const atom = {atom: 'draw', n: args[0]};
      i += tryAttachPerModifier(ops, i, atom);
      atoms.push(atom);
      continue;
    }
    if (method === 'resource') {
      const resVal = args[0];
      const second = args[1];
      let n = 1, any = false;
      if (typeof second === 'number') n = second;
      else if (second && typeof second === 'object') {
        if (second.amount !== undefined) n = second.amount;
        if (second.all) any = true;
      }
      const atom = {atom: 'card_res', res: String(resVal).toLowerCase(), n, target: any ? 'any' : 'this'};
      i += tryAttachPerModifier(ops, i, atom);
      atoms.push(atom);
      continue;
    }
    if (method === 'tile') { atoms.push({atom: 'tile', tile: args[0]}); continue; }
    if (method === 'greenery') { atoms.push({atom: 'tile', tile: 'greenery', any: !!(args[0] && args[0].any)}); continue; }
    if (method === 'city') { atoms.push({atom: 'tile', tile: 'city'}); continue; }
    if (method === 'cityorSpecialTile' || method === 'specialTile') { atoms.push({atom: 'tile', tile: 'special'}); continue; }
    if (method === 'tag') {
      ctx.flagManual('bare-tag-icon');
      atoms.push({atom: 'text', en: 'tag:' + args[0]});
      continue;
    }
    if (method === 'text' || method === 'plainText' || method === 'plate') {
      const s = args[0];
      if (typeof s === 'string' && s.length > 0) {
        const ko = ctx.translate(s);
        atoms.push({atom: 'text', en: s, ko});
        ctx.texts.push({en: s, ko});
      }
      continue;
    }
    if (method === 'effect' || method === 'standardProject') {
      if (method === 'standardProject') continue; // out of scope kind
      const desc = args[0];
      const fnArg = args[1];
      const stmtOps = ((fnArg && fnArg.statements) || []).flat();
      const splitIdx = stmtOps.findIndex((o) => o.method === 'startEffect');
      const resultOps = splitIdx >= 0 ? stmtOps.slice(splitIdx + 1) : stmtOps;
      const resultAtoms = convertOpsToAtoms(resultOps, ctx);
      // The live app's i18n key for effect()/action() text includes the "Effect: "/
      // "Action: " prefix CardRenderer prepends; try that form of the key first.
      const ko = typeof desc === 'string' ? (ctx.translate('Effect: ' + desc) ?? ctx.translate(desc)) : undefined;
      const triggerText = typeof desc === 'string' ? (ko ?? desc) : '';
      if (typeof desc === 'string') ctx.texts.push({en: desc, ko});
      if (typeof desc !== 'string') ctx.flagManual('effect-missing-description');
      atoms.push({atom: 'effect', trigger: triggerText, result: resultAtoms});
      continue;
    }
    if (method === 'action') {
      const desc = args[0];
      const fnArg = args[1];
      const stmtOps = ((fnArg && fnArg.statements) || []).flat();
      const splitIdx = stmtOps.findIndex((o) => o.method === 'startAction');
      const costOps = splitIdx >= 0 ? stmtOps.slice(0, splitIdx) : [];
      const gainOps = splitIdx >= 0 ? stmtOps.slice(splitIdx + 1) : stmtOps;
      const actionKo = typeof desc === 'string' ? (ctx.translate('Action: ' + desc) ?? ctx.translate(desc)) : undefined;
      atoms.push({atom: 'action', cost: convertOpsToAtoms(costOps, ctx), gain: convertOpsToAtoms(gainOps, ctx)});
      if (typeof desc === 'string') ctx.texts.push({en: desc, ko: actionKo});
      if (typeof desc !== 'string') ctx.flagManual('action-missing-description');
      continue;
    }
    if (method === 'corpBox') {
      const fnArg = args[args.length - 1];
      if (fnArg && fnArg.statements) atoms.push(...convertStatementsToAtoms(fnArg.statements, ctx));
      continue;
    }
    if (method === 'super') {
      // `.super(fn)` renders its content as a small superscript annotation (e.g.
      // "titanium may also be used") — not an additional additive cost/gain, so we
      // don't merge its atoms into the flat stream; flag for manual review instead.
      ctx.flagManual('superscript-annotation');
      const fnArg = args[args.length - 1];
      const innerOps = ((fnArg && fnArg.statements) || []).flat();
      atoms.push({atom: 'text', en: 'superscript: ' + innerOps.map((o) => o.method + '(' + JSON.stringify(o.args) + ')').join(' ')});
      continue;
    }

    // Unmapped / expansion-only methods not expected in base+corpera scope.
    ctx.flagManual('unmapped-render-method:' + method);
    atoms.push({atom: 'text', en: method + (args.length ? '(' + JSON.stringify(args).slice(0, 80) + ')' : '')});
  }
  return atoms;
}

// ---------------------------------------------------------------------------
// behavior (declarative) -> atoms, used as a fallback when renderData is
// absent or empty (this happens for a few corp cards whose only "effect" is
// bespoke imperative code we can't safely interpret — those stay flagged).
// ---------------------------------------------------------------------------

function behaviorToAtoms(behavior, ctx) {
  if (!behavior || typeof behavior !== 'object') return [];
  const atoms = [];
  const push = (a) => atoms.push(a);

  if (behavior.production) {
    for (const [res, n] of Object.entries(behavior.production)) {
      if (n === undefined) continue;
      push({atom: 'prod', res: resName(res), n});
    }
  }
  if (behavior.stock) {
    for (const [res, n] of Object.entries(behavior.stock)) {
      if (n === undefined) continue;
      push({atom: 'gain', res: resName(res), n});
    }
  }
  if (behavior.global) {
    for (const [param, n] of Object.entries(behavior.global)) {
      if (n === undefined) continue;
      push({atom: 'global', param, n});
    }
  }
  if (behavior.tr !== undefined) push({atom: 'tr', n: typeof behavior.tr === 'number' ? behavior.tr : 1});
  if (behavior.drawCard !== undefined) {
    const n = typeof behavior.drawCard === 'number' ? behavior.drawCard : (behavior.drawCard.count ?? 1);
    push({atom: 'draw', n});
  }
  if (behavior.ocean) push({atom: 'tile', tile: 'ocean', n: behavior.ocean.count ?? 1});
  if (behavior.greenery) push({atom: 'tile', tile: 'greenery'});
  if (behavior.city) push({atom: 'tile', tile: 'city'});
  if (behavior.tile && behavior.tile.type !== undefined) push({atom: 'tile', tile: behavior.tile.type, where: behavior.tile.on});
  if (behavior.addResources !== undefined) {
    const n = typeof behavior.addResources === 'number' ? behavior.addResources : (behavior.addResources.count ?? 1);
    push({atom: 'card_res', res: 'self', n, target: 'this'});
  }
  if (behavior.decreaseAnyProduction) {
    push({atom: 'prod', res: resName(behavior.decreaseAnyProduction.type), n: -Math.abs(behavior.decreaseAnyProduction.count), any: true});
  }
  if (behavior.removeAnyPlants !== undefined) push({atom: 'prod', res: 'plants', n: -Math.abs(behavior.removeAnyPlants), any: true});
  if (behavior.titaniumValue !== undefined) {
    ctx.flagManual('behavior-titaniumValue');
    push({atom: 'text', en: 'titaniumValue:' + behavior.titaniumValue});
  }
  if (behavior.steelValue !== undefined) {
    ctx.flagManual('behavior-steelValue');
    push({atom: 'text', en: 'steelValue:' + behavior.steelValue});
  }
  if (behavior.standardResource !== undefined) {
    const n = typeof behavior.standardResource === 'number' ? behavior.standardResource : behavior.standardResource.count;
    ctx.flagManual('behavior-standardResource');
    push({atom: 'text', en: 'standardResource:' + n});
  }
  if (behavior.spend || behavior.lose || behavior.or || behavior.colonies || behavior.turmoil || behavior.moon || behavior.underworld ||
      behavior.addResourcesToAnyCard || behavior.removeResourcesFromAnyCard || behavior.greeneryDiscount) {
    ctx.flagManual('behavior-unmapped-field:' + Object.keys(behavior).join(','));
  }
  return atoms;
}

// ---------------------------------------------------------------------------
// requirements / victoryPoints / cardDiscount -> this project's schema
// ---------------------------------------------------------------------------

const REQ_PRIORITY = [
  'tag', 'oceans', 'oxygen', 'temperature', 'venus', 'tr', 'chairman', 'resourceTypes',
  'greeneries', 'cities', 'colonies', 'floaters', 'partyLeader', 'production', 'party',
  'plantsRemoved', 'habitatRate', 'miningRate', 'logisticRate', 'habitatTiles', 'miningTiles',
  'roadTiles', 'undergroundTokens', 'corruption',
];

function convertRequirement(desc) {
  if (!desc) return null;
  const type = REQ_PRIORITY.find((k) => desc[k] !== undefined);
  if (!type) return {atom_unmapped: true, raw: desc};
  const out = {type, value: desc[type], max: !!desc.max};
  if (desc.tag !== undefined) out.tag = desc.tag;
  if (desc.count !== undefined) out.count = desc.count;
  if (desc.all) out.all = true;
  if (desc.nextTo) out.nextTo = true;
  if (desc.text) out.text = desc.text;
  return out;
}

function convertRequirements(raw) {
  if (raw === undefined || raw === null) return null;
  const arr = Array.isArray(raw) ? raw : [raw];
  const converted = arr.map(convertRequirement).filter(Boolean);
  if (converted.length === 0) return null;
  return converted.length === 1 ? converted[0] : converted;
}

function convertVictoryPoints(vp, resourceType) {
  if (vp === undefined || vp === null) return null;
  if (typeof vp === 'number') return {type: 'fixed', value: vp};
  if (vp === 'special') return {type: 'special', value: null};
  if (typeof vp === 'object') {
    const each = vp.each ?? 1;
    const per = vp.per ?? 1;
    if (vp.tag !== undefined) return {type: 'per_tag', value: each, per, of: vp.tag};
    if (vp.resourcesHere !== undefined) return {type: 'per_resource', value: each, per, of: resourceType ? String(resourceType).toLowerCase() : 'resourcesHere'};
    if (vp.cities !== undefined) return {type: 'per_tile', value: each, per, of: 'city'};
    if (vp.oceans !== undefined) return {type: 'per_tile', value: each, per, of: 'ocean'};
    if (vp.moon && vp.moon.mine !== undefined) return {type: 'per_tile', value: each, per, of: 'moon_mine'};
    if (vp.moon && vp.moon.road !== undefined) return {type: 'per_tile', value: each, per, of: 'moon_road'};
    if (vp.colonies && vp.colonies.colonies !== undefined) return {type: 'per_resource', value: each, per, of: 'colony'};
    return {atom_unmapped: true, raw: vp};
  }
  return {atom_unmapped: true, raw: vp};
}

function convertCardDiscount(raw) {
  if (!raw) return null;
  const arr = Array.isArray(raw) ? raw : [raw];
  return arr.map((d) => ({atom: 'discount', n: d.amount, tag: d.tag ?? null, per: d.per ?? 'card'}));
}

// ---------------------------------------------------------------------------
// Korean helpers: 초성 (leading-consonant) extraction + Revised Romanization,
// used only to build the free-text "search" field.
// ---------------------------------------------------------------------------

const CHO = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
const RR_CHO = ['g', 'kk', 'n', 'd', 'tt', 'r', 'm', 'b', 'pp', 's', 'ss', '', 'j', 'jj', 'ch', 'k', 't', 'p', 'h'];
const RR_JUNG = ['a', 'ae', 'ya', 'yae', 'eo', 'e', 'yeo', 'ye', 'o', 'wa', 'wae', 'oe', 'yo', 'u', 'weo', 'we', 'wi', 'yu', 'eu', 'yi', 'i'];
const RR_JONG = ['', 'g', 'kk', 'gs', 'n', 'nj', 'nh', 'd', 'l', 'lg', 'lm', 'lb', 'ls', 'lt', 'lp', 'lh', 'm', 'b', 'bs', 's', 'ss', 'ng', 'j', 'ch', 'k', 't', 'p', 'h'];

function choseongOf(str) {
  let out = '';
  for (const ch of str) {
    const code = ch.codePointAt(0);
    if (code >= 0xAC00 && code <= 0xD7A3) out += CHO[Math.floor((code - 0xAC00) / (21 * 28))];
  }
  return out;
}

function romanize(str) {
  let out = '';
  for (const ch of str) {
    const code = ch.codePointAt(0);
    if (code >= 0xAC00 && code <= 0xD7A3) {
      const idx = code - 0xAC00;
      out += RR_CHO[Math.floor(idx / (21 * 28))] + RR_JUNG[Math.floor((idx % (21 * 28)) / 28)] + RR_JONG[idx % 28];
    } else if (/\s/.test(ch)) out += ' ';
    else if (/[a-zA-Z0-9]/.test(ch)) out += ch;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Locale loading: merge every src/locales/ko/*.json into one lookup, with
// base_cards.json/base_corporations.json taking precedence (the live app
// resolves i18n keys against a merged resource bundle; some card/tile names
// and condition texts are only present in UI.json or other shared files).
// ---------------------------------------------------------------------------

function loadMergedLocale() {
  const LOCALE_DIR = path.join(SRC_ROOT, 'src/locales/ko');
  const PRIORITY = ['base_cards.json', 'base_corporations.json'];
  const allFiles = fs.readdirSync(LOCALE_DIR).filter((f) => f.endsWith('.json'));
  const ordered = [...PRIORITY, ...allFiles.filter((f) => !PRIORITY.includes(f))];
  const merged = {};
  for (const f of ordered) {
    const d = JSON.parse(fs.readFileSync(path.join(LOCALE_DIR, f), 'utf8'));
    for (const [k, v] of Object.entries(d)) {
      if (!(k in merged)) merged[k] = v;
    }
  }
  return merged;
}

function makeTranslate(merged) {
  return function translate(s) {
    if (merged[s] !== undefined) return merged[s];
    if (s.startsWith('(') && s.endsWith(')')) {
      const inner = merged[s.slice(1, -1)];
      if (inner !== undefined) return '(' + inner + ')';
    }
    return undefined;
  };
}

// ---------------------------------------------------------------------------
// Main extraction loop
// ---------------------------------------------------------------------------

function extractCard(rec, maps, translate) {
  const manualReasons = [];
  const ctx = makeCtx({
    translate: (s) => translate(s) ?? null,
    flagManual: (reason) => manualReasons.push(reason),
  });

  const {superCallNode, paramDefaults} = parseCardFile(rec.filePath);
  if (!superCallNode) {
    return {num: null, en: rec.className, kind: rec.kind, needs_manual: true, note: 'no super() call found', effects: [], search: rec.className};
  }
  setLocalDefaults(paramDefaults);
  const argNode = superCallNode.arguments[0];
  const warnings = [];
  let data;
  if (ts.isObjectLiteralExpression(argNode)) {
    data = evalData(argNode, maps, warnings, rec.filePath);
  } else if (rec.className === 'MiningRights' || rec.className === 'MiningArea') {
    // These two extend an intermediate MiningCard base class and call
    // super(name, cost, metadata) positionally; MiningCard itself always sets
    // type: AUTOMATED, tags: [BUILDING] (verified by reading MiningCard.ts).
    const sArgs = superCallNode.arguments;
    data = {
      type: 'automated',
      tags: ['building'],
      name: evalData(sArgs[0], maps, warnings, rec.filePath),
      cost: evalData(sArgs[1], maps, warnings, rec.filePath),
      metadata: evalMetadataNode(sArgs[2], maps, warnings, rec.filePath),
    };
  } else {
    manualReasons.push('super-call-not-object-literal');
    data = {};
  }
  for (const w of warnings) {
    if (w.kind === 'unexpected-call' && /CardRenderer\.builder/.test(w.text)) continue; // handled separately
    manualReasons.push(w.kind + ':' + w.text.slice(0, 60));
  }

  let renderCall = findRenderDataCall(argNode);
  if (!renderCall && paramDefaults.metadata) renderCall = findRenderDataCall(paramDefaults.metadata);
  const renderWarnings = [];
  const statements = renderCall ? interpretRenderData(renderCall, maps, renderWarnings, rec.filePath) : null;
  for (const w of renderWarnings) manualReasons.push('render:' + w.kind + ':' + w.text.slice(0, 60));

  let effects = statements ? convertStatementsToAtoms(statements, ctx) : [];
  if (effects.length === 0 && data.behavior) {
    const behAtoms = behaviorToAtoms(data.behavior, ctx);
    if (behAtoms.length > 0) {
      effects = behAtoms;
      manualReasons.push('effects-derived-from-behavior-fallback');
    }
  }

  let enName = data.name;
  if (typeof enName !== 'string') {
    manualReasons.push('unresolved-name');
    enName = maps.CardName[rec.cardNameKey] ?? rec.className;
  }
  const koName = translate(enName) ?? null;
  if (!koName) manualReasons.push('missing-ko-name');

  let enText = null;
  if (typeof data.metadata?.description === 'string') enText = data.metadata.description;
  else if (data.metadata?.description && typeof data.metadata.description === 'object') enText = data.metadata.description.text;
  let koText = enText ? (translate(enText) ?? null) : null;
  if (!enText && ctx.texts.length > 0) {
    enText = ctx.texts.map((t) => t.en).join(' ');
    koText = ctx.texts.map((t) => t.ko || t.en).join(' ');
  }
  if (!enText) manualReasons.push('no-description-text-found');

  const typeColorMap = {automated: 'green', active: 'blue', event: 'red', corporation: 'corp'};

  const card = {
    num: data.metadata?.cardNumber ?? null,
    ko: koName,
    en: enName,
    kind: rec.kind,
    color: typeColorMap[data.type] ?? (rec.kind === 'corporation' ? 'corp' : null),
    cost: data.cost ?? null,
    corporateEra: rec.module === 'corpera',
    tags: data.tags ?? [],
    req: convertRequirements(data.requirements),
    effects,
    vp: convertVictoryPoints(data.victoryPoints, data.resourceType),
    ko_text: koText,
    en_text: enText,
    needs_manual: manualReasons.length > 0,
    note: manualReasons.join('; '),
  };
  if (rec.kind === 'corporation' && data.startingMegaCredits !== undefined) {
    card.startingMegaCredits = data.startingMegaCredits;
  }
  if (data.cardDiscount) {
    card.effects = [...convertCardDiscount(data.cardDiscount), ...card.effects];
  }
  const searchParts = [
    koName, enName, romanize(koName || ''), choseongOf(koName || ''), card.num,
    (enName || '').toLowerCase().replace(/\s+/g, ''),
  ].filter(Boolean);
  card.search = searchParts.join(' ');

  return card;
}

function main() {
  const maps = buildEnumMaps();
  const records = parseManifests();
  const merged = loadMergedLocale();
  const translate = makeTranslate(merged);

  const cards = records.map((rec) => extractCard(rec, maps, translate));

  // ---- validation ----
  const issues = [];
  const projectCount = cards.filter((c) => c.kind === 'project').length;
  const corpCount = cards.filter((c) => c.kind === 'corporation').length;
  if (projectCount !== 208) issues.push(`expected 208 project cards, found ${projectCount}`);
  const numCounts = {};
  for (const c of cards) numCounts[c.num] = (numCounts[c.num] || 0) + 1;
  const dupNums = Object.entries(numCounts).filter(([, n]) => n > 1);
  if (dupNums.length > 0) issues.push(`duplicate card numbers: ${dupNums.map(([n]) => n).join(', ')}`);
  const missingKo = cards.filter((c) => !c.ko);
  if (missingKo.length > 0) issues.push(`missing Korean name for: ${missingKo.map((c) => c.en).join(', ')}`);

  fs.mkdirSync(OUT_DIR, {recursive: true});
  fs.writeFileSync(path.join(OUT_DIR, 'cards.json'), JSON.stringify(cards, null, 1));

  writeAtomsDoc(cards, path.join(OUT_DIR, 'atoms.md'));
  writeManualDoc(cards, path.join(OUT_DIR, 'manual.md'));

  console.log(`Wrote ${cards.length} cards (${projectCount} project, ${corpCount} corporation) to ${path.join(OUT_DIR, 'cards.json')}`);
  console.log(`needs_manual: ${cards.filter((c) => c.needs_manual).length}`);
  if (issues.length > 0) {
    console.log('VALIDATION ISSUES:');
    for (const i of issues) console.log(' - ' + i);
    process.exitCode = 1;
  } else {
    console.log('Validation OK: 208 project cards, no duplicate numbers, no missing Korean names.');
  }
}

// Walks every atom (including nested effect.result / action.cost / action.gain)
// and collects {type -> [example cards]} for data/atoms.md.
function collectAtomExamples(cards) {
  const byType = {};
  function visit(atom, card) {
    if (!atom || typeof atom !== 'object') return;
    const type = atom.atom;
    if (type) {
      byType[type] = byType[type] || {count: 0, cards: new Set()};
      byType[type].count++;
      byType[type].cards.add(`${card.num} ${card.ko} (${card.en})`);
    }
    if (Array.isArray(atom.result)) atom.result.forEach((a) => visit(a, card));
    if (Array.isArray(atom.cost)) atom.cost.forEach((a) => visit(a, card));
    if (Array.isArray(atom.gain)) atom.gain.forEach((a) => visit(a, card));
  }
  for (const card of cards) {
    for (const atom of card.effects || []) visit(atom, card);
  }
  return byType;
}

function writeAtomsDoc(cards, outPath) {
  const byType = collectAtomExamples(cards);
  let md = '# 원자(atom) 종류별 통계\n\n';
  md += `생성: \`tools/extract_cards.mjs\` 실행 결과. 전체 카드 ${cards.length}장에서 발견된 원자 종류와 등장 횟수, 예시 카드 3장씩.\n\n`;
  md += '| atom | 개수 | 예시 카드 |\n|---|---|---|\n';
  const sorted = Object.entries(byType).sort((a, b) => b[1].count - a[1].count);
  for (const [type, info] of sorted) {
    const examples = [...info.cards].slice(0, 3).join('; ');
    md += `| ${type} | ${info.count} | ${examples} |\n`;
  }
  md += '\n## 필드 설명\n\n';
  md += '- `prod` / `gain`: `res`(mc/steel/titanium/plant/energy/heat), `n`(증감량), `any`(아무 플레이어 대상 여부), `per`(있으면 "n당 1회" 배수/태그 조건)\n';
  md += '- `global`: `param`(temperature/oxygen/venus), `n`\n';
  md += '- `tr`: `n`\n';
  md += '- `tile`: `tile`(ocean/greenery/city/special 등), `n`(개수), `where`\n';
  md += '- `draw`: `n` (음수면 카드 버리기)\n';
  md += '- `card_res`: 카드 위 자원(동물/미생물/과학 등). `res`, `n`, `target`(this/any)\n';
  md += '- `action`: 파란 카드 행동. `cost`(원자 배열), `gain`(원자 배열)\n';
  md += '- `effect`: 지속 효과(빨간/파란 테두리). `trigger`(한국어 설명 문자열), `result`(원자 배열)\n';
  md += '- `discount`: 카드 할인. `n`, `tag`, `per`\n';
  md += '- `text`: 위 원자로 표현하지 못한 텍스트/아이콘. `en`, `ko`\n';
  fs.writeFileSync(outPath, md);
}

function writeManualDoc(cards, outPath) {
  const manual = cards.filter((c) => c.needs_manual);
  let md = '# 수동 검토 필요 카드 목록\n\n';
  md += `총 ${cards.length}장 중 ${manual.length}장(${(100 * manual.length / cards.length).toFixed(1)}%)이 \`needs_manual: true\`로 표시되었습니다.\n`;
  md += '아래 각 카드는 자동 추출이 애매했던 지점을 "사유"에 남겼습니다. 대부분 원문 카드 자체가 조건부/가변 수치(X칸)·OR 선택형·중첩 텍스트처럼\n';
  md += '렌더링 빌더 API를 자유 형식으로 사용한 경우이며, `effects` 필드가 비어있거나 일부 `{"atom":"text"}` 플레이스홀더를 포함할 수 있습니다.\n\n';
  md += '| 번호 | 영문명 | 한글명 | kind | 사유 |\n|---|---|---|---|---|\n';
  for (const c of manual) {
    md += `| ${c.num ?? '-'} | ${c.en} | ${c.ko ?? '-'} | ${c.kind} | ${c.note} |\n`;
  }
  fs.writeFileSync(outPath, md);
}

main();
