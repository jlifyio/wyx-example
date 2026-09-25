/**
 * Per-file fact extraction for the pilot-01 scorer, using the TypeScript compiler API:
 * import edges with per-symbol value/type use (S2, S2b), the re-export graph (S7),
 * declarations, comments and string literals (S10) and exported repository Maps (S8 STORE_EXPORT).
 */
import ts from "typescript";

export type Use = "value" | "type";
export type Kind =
  | "static" | "side-effect" | "export-from" | "export-star" | "import-equals"
  | "require" | "dynamic" | "import-meta-require" | "create-require" | "import-type";

export interface Sym { name: string; use: Use }
export interface ImportRec {
  kind: Kind;
  spec: string | null;
  line: number;
  text: string;
  syms: Sym[];
  nsUnresolved: boolean;
}
export type Hop =
  | { t: "from"; spec: string; name: string; typeOnly: boolean }
  | { t: "ns"; spec: string; typeOnly: boolean };
export interface Decl { name: string; kind: string; line: number }
export interface TextLine { line: number; text: string }
export interface FileFacts {
  imports: ImportRec[];
  reexports: Map<string, Hop[]>;
  stars: Array<{ spec: string; typeOnly: boolean }>;
  exportedNames: Set<string>;
  decls: Decl[];
  comments: TextLine[];
  literals: TextLine[];
  exportedMaps: string[];
  parseErrors: string[];
}

type Binding = { spec: string; imported: string; typeOnly: boolean };

const GLOBAL_OBJECTS = new Set(["module", "globalThis", "global", "self", "window"]);
const OBJECT_WRAPPERS = new Set(["freeze", "seal", "preventExtensions", "assign"]);

function unwrap(e: ts.Expression): ts.Expression {
  while (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isSatisfiesExpression(e) || ts.isNonNullExpression(e) ||
    ts.isTypeAssertionExpression(e) || ts.isAwaitExpression(e)) e = e.expression;
  return e;
}

function scriptKind(file: string): ts.ScriptKind {
  if (/\.tsx$/.test(file)) return ts.ScriptKind.TSX;
  if (/\.jsx$/.test(file)) return ts.ScriptKind.JSX;
  if (/\.[cm]?js$/.test(file)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

/** Folds a string literal, a no-substitution template or a `+` concatenation of those; null otherwise. */
export function foldSpecifier(e: ts.Node | undefined): string | null {
  if (!e) return null;
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text;
  if (ts.isParenthesizedExpression(e)) return foldSpecifier(e.expression);
  if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const a = foldSpecifier(e.left);
    const b = foldSpecifier(e.right);
    return a !== null && b !== null ? a + b : null;
  }
  return null;
}

function literalKey(e: ts.Node | undefined): string | null {
  if (!e) return null;
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e) || ts.isNumericLiteral(e)) return e.text;
  return null;
}

function nameText(n: ts.Node | undefined): string | null {
  if (!n) return null;
  if (ts.isIdentifier(n) || ts.isStringLiteral(n) || ts.isPrivateIdentifier(n)) return n.text;
  return null;
}

/** An Identifier that names a binding use rather than a declaration, property name or label. */
function isRef(id: ts.Identifier): boolean {
  const p = id.parent;
  if (!p) return false;
  if (ts.isPropertyAccessExpression(p)) return p.name !== id;
  if (ts.isQualifiedName(p)) return p.right !== id;
  if (ts.isShorthandPropertyAssignment(p)) return true;
  if (
    (ts.isPropertyAssignment(p) || ts.isPropertyDeclaration(p) || ts.isPropertySignature(p) ||
      ts.isMethodDeclaration(p) || ts.isMethodSignature(p) || ts.isGetAccessorDeclaration(p) ||
      ts.isSetAccessorDeclaration(p) || ts.isEnumMember(p) || ts.isJsxAttribute(p) || ts.isNamedTupleMember(p)) &&
    p.name === id
  ) return false;
  if (ts.isBindingElement(p)) return p.propertyName !== id && p.name !== id;
  if ((ts.isVariableDeclaration(p) || ts.isParameter(p)) && p.name === id) return false;
  if (
    (ts.isFunctionDeclaration(p) || ts.isFunctionExpression(p) || ts.isClassDeclaration(p) ||
      ts.isClassExpression(p) || ts.isInterfaceDeclaration(p) || ts.isTypeAliasDeclaration(p) ||
      ts.isEnumDeclaration(p) || ts.isModuleDeclaration(p) || ts.isTypeParameterDeclaration(p)) &&
    p.name === id
  ) return false;
  if (ts.isImportSpecifier(p) || ts.isImportClause(p) || ts.isNamespaceImport(p) || ts.isNamespaceExport(p)) return false;
  if (ts.isImportEqualsDeclaration(p)) return p.name !== id;
  if (ts.isExportSpecifier(p)) {
    if (p.parent.parent.moduleSpecifier) return false;
    return (p.propertyName ?? p.name) === id;
  }
  if (ts.isLabeledStatement(p) || ts.isBreakOrContinueStatement(p) || ts.isMetaProperty(p) || ts.isImportTypeNode(p)) return false;
  return true;
}

/** S2b type position: inside a TypeNode, an interface or type alias, or an interface/implements heritage clause. */
export function isTypePosition(node: ts.Node): boolean {
  let n: ts.Node = node;
  while (n.parent) {
    const p = n.parent;
    if (p.kind >= ts.SyntaxKind.FirstTypeNode && p.kind <= ts.SyntaxKind.LastTypeNode) return true;
    if (ts.isExpressionWithTypeArguments(p) && ts.isHeritageClause(p.parent)) {
      const hc = p.parent;
      if (ts.isInterfaceDeclaration(hc.parent)) return true;
      return hc.token === ts.SyntaxKind.ImplementsKeyword;
    }
    if (ts.isInterfaceDeclaration(p) || ts.isTypeAliasDeclaration(p)) return true;
    if (ts.isExportSpecifier(p) && (p.isTypeOnly || p.parent.parent.isTypeOnly)) return true;
    n = p;
  }
  return false;
}

export function extractFacts(file: string, code: string): FileFacts {
  const sf = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, scriptKind(file));
  const lineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const snippet = (n: ts.Node) => n.getText(sf).replace(/\s+/g, " ").slice(0, 160);

  const refs = new Map<string, ts.Identifier[]>();
  const all: ts.Node[] = [];
  const walk = (n: ts.Node) => {
    all.push(n);
    if (ts.isIdentifier(n) && isRef(n)) {
      const l = refs.get(n.text);
      if (l) l.push(n); else refs.set(n.text, [n]);
    }
    ts.forEachChild(n, walk);
  };
  walk(sf);
  const refsIn = (name: string, scope: ts.Node | null) =>
    (refs.get(name) ?? []).filter(r => !scope || (r.pos >= scope.pos && r.end <= scope.end));

  const facts: FileFacts = {
    imports: [], reexports: new Map(), stars: [], exportedNames: new Set(), decls: [],
    comments: [], literals: [], exportedMaps: [],
    parseErrors: ((sf as any).parseDiagnostics ?? []).map((d: ts.Diagnostic) =>
      `${sf.getLineAndCharacterOfPosition(d.start ?? 0).line + 1}: ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`),
  };
  const bindings = new Map<string, Binding>();
  const createRequireIds = new Set<string>();

  // Scope of a variable declaration: the enclosing block for let/const, the enclosing function for var; null = file.
  const declScope = (d: ts.VariableDeclaration): ts.Node | null => {
    const list = d.parent;
    const blockScoped = ts.isVariableDeclarationList(list) && (list.flags & ts.NodeFlags.BlockScoped) !== 0;
    let s: ts.Node = list;
    while (s.parent) {
      s = s.parent;
      if (ts.isSourceFile(s)) return null;
      if (ts.isFunctionLike(s) || ts.isClassStaticBlockDeclaration(s)) return s;
      if (blockScoped && (ts.isBlock(s) || ts.isModuleBlock(s) || ts.isCaseBlock(s) || ts.isForStatement(s) ||
        ts.isForInStatement(s) || ts.isForOfStatement(s))) return s;
    }
    return null;
  };

  // Members of a namespace-like binding (import * as, import = require, const m = require()/await import()).
  const nsMembers = (name: string, scope: ts.Node | null, forceType: boolean) => {
    const syms: Sym[] = [];
    let unresolved = false;
    for (const r of refsIn(name, scope)) {
      const use: Use = forceType || isTypePosition(r) ? "type" : "value";
      const p = r.parent;
      if (ts.isPropertyAccessExpression(p) && p.expression === r) { syms.push({ name: p.name.text, use }); continue; }
      if (ts.isQualifiedName(p) && p.left === r) { syms.push({ name: p.right.text, use }); continue; }
      if (ts.isElementAccessExpression(p) && p.expression === r) {
        const k = literalKey(p.argumentExpression);
        if (k !== null) { syms.push({ name: k, use }); continue; }
      }
      if (ts.isVariableDeclaration(p) && p.initializer === r && ts.isObjectBindingPattern(p.name)) {
        const d = destructured(p.name);
        syms.push(...d.names.map(x => ({ name: x, use })));
        if (d.unresolved) { syms.push({ name: "*", use }); unresolved = true; }
        continue;
      }
      syms.push({ name: "*", use });
      unresolved = true;
    }
    return { syms, unresolved, used: refsIn(name, scope).length > 0 };
  };
  const destructured = (pat: ts.ObjectBindingPattern) => {
    const names: string[] = [];
    let unresolved = false;
    for (const el of pat.elements) {
      if (el.dotDotDotToken) { unresolved = true; continue; }
      const k = el.propertyName ? nameText(el.propertyName) ?? literalKey(el.propertyName) : nameText(el.name);
      if (k === null) unresolved = true; else names.push(k);
    }
    return { names, unresolved };
  };

  // Symbols taken from a require()/import() call expression, following its consumer.
  const callBinding = (call: ts.CallExpression, spec: string | null, dynamic: boolean): { syms: Sym[]; unresolved: boolean } => {
    let n: ts.Node = call;
    while (n.parent && (ts.isParenthesizedExpression(n.parent) || ts.isAwaitExpression(n.parent) || ts.isAsExpression(n.parent) ||
      ts.isNonNullExpression(n.parent) || ts.isSatisfiesExpression(n.parent) || ts.isTypeAssertionExpression(n.parent))) n = n.parent;
    const p = n.parent;
    const val = (names: string[]) => names.map(x => ({ name: x, use: "value" as Use }));
    if (dynamic && p && ts.isPropertyAccessExpression(p) && p.expression === n && p.name.text === "then" &&
      ts.isCallExpression(p.parent) && p.parent.expression === p) {
      const cb = p.parent.arguments[0];
      if (cb && (ts.isArrowFunction(cb) || ts.isFunctionExpression(cb)) && cb.parameters[0]) {
        const pn = cb.parameters[0].name;
        if (ts.isIdentifier(pn)) {
          const m = nsMembers(pn.text, cb.body, false);
          return m.used ? { syms: m.syms, unresolved: m.unresolved } : { syms: val(["*"]), unresolved: false };
        }
        if (ts.isObjectBindingPattern(pn)) {
          const d = destructured(pn);
          return { syms: val(d.unresolved ? [...d.names, "*"] : d.names), unresolved: d.unresolved };
        }
      }
      return { syms: val(["*"]), unresolved: true };
    }
    if (p && ts.isVariableDeclaration(p) && p.initializer === n) {
      if (ts.isIdentifier(p.name)) {
        if (spec !== null) bindings.set(p.name.text, { spec, imported: "*", typeOnly: false });
        const m = nsMembers(p.name.text, declScope(p), false);
        return m.used ? { syms: m.syms, unresolved: m.unresolved } : { syms: val(["*"]), unresolved: false };
      }
      if (ts.isObjectBindingPattern(p.name)) {
        const d = destructured(p.name);
        if (spec !== null) for (const el of p.name.elements) {
          const k = el.propertyName ? nameText(el.propertyName) : nameText(el.name);
          if (!el.dotDotDotToken && k !== null && ts.isIdentifier(el.name)) bindings.set(el.name.text, { spec, imported: k, typeOnly: false });
        }
        return { syms: val(d.unresolved ? [...d.names, "*"] : d.names), unresolved: d.unresolved };
      }
      return { syms: val(["*"]), unresolved: true };
    }
    if (p && ts.isPropertyAccessExpression(p) && p.expression === n) return { syms: val([p.name.text]), unresolved: false };
    if (p && ts.isElementAccessExpression(p) && p.expression === n) {
      const k = literalKey(p.argumentExpression);
      return k !== null ? { syms: val([k]), unresolved: false } : { syms: val(["*"]), unresolved: true };
    }
    if (p && ts.isExpressionStatement(p)) return { syms: val(["*"]), unresolved: false };
    return { syms: val(["*"]), unresolved: true };
  };

  const push = (kind: Kind, specNode: ts.Node | undefined, at: ts.Node, syms: Sym[], nsUnresolved: boolean) => {
    const spec = foldSpecifier(specNode);
    facts.imports.push({ kind, spec, line: lineOf(at), text: specNode ? snippet(specNode) : "", syms, nsUnresolved });
  };

  // Pass 1: createRequire factories (imported under any local name, or X.createRequire) and the loaders they bind.
  const factories = new Set(["createRequire"]);
  for (const n of all) if (ts.isImportSpecifier(n) && (n.propertyName ?? n.name).text === "createRequire") factories.add(n.name.text);
  const isFactory = (c: ts.Expression) => {
    const u = unwrap(c);
    return (ts.isIdentifier(u) && factories.has(u.text)) || (ts.isPropertyAccessExpression(u) && u.name.text === "createRequire");
  };
  for (const n of all) {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) {
      const init = unwrap(n.initializer);
      if (ts.isCallExpression(init) && isFactory(init.expression)) createRequireIds.add(n.name.text);
    }
  }
  const globalRequire = (e: ts.Expression) => {
    if (!ts.isPropertyAccessExpression(e) || e.name.text !== "require") return null;
    const o = unwrap(e.expression);
    if (ts.isMetaProperty(o)) return "import-meta-require" as const;
    return ts.isIdentifier(o) && GLOBAL_OBJECTS.has(o.text) ? "require" as const : null;
  };

  const importCallKind = (n: ts.CallExpression): Kind | null => {
    if (n.expression.kind === ts.SyntaxKind.ImportKeyword) return "dynamic";
    const e = unwrap(n.expression);
    if (ts.isIdentifier(e) && e.text === "require") return "require";
    const g = globalRequire(e);
    if (g) return g;
    if (ts.isIdentifier(e) && createRequireIds.has(e.text)) return "create-require";
    if (ts.isCallExpression(e) && isFactory(e.expression)) return "create-require";
    return null;
  };

  // Pass 2: import edges.
  for (const n of all) {
    if (ts.isImportDeclaration(n)) {
      const c = n.importClause;
      const spec = foldSpecifier(n.moduleSpecifier);
      if (!c) { push("side-effect", n.moduleSpecifier, n, [{ name: "*", use: "value" }], false); continue; }
      const clauseType = c.phaseModifier === ts.SyntaxKind.TypeKeyword;
      const syms: Sym[] = [];
      let unresolved = false;
      const named = (local: string, imported: string, synType: boolean) => {
        if (spec !== null) bindings.set(local, { spec, imported, typeOnly: synType });
        const rs = refsIn(local, null);
        const typeOnly = synType || (rs.length > 0 && rs.every(r => isTypePosition(r)));
        syms.push({ name: imported, use: typeOnly ? "type" : "value" });
      };
      if (c.name) named(c.name.text, "default", clauseType);
      const nb = c.namedBindings;
      if (nb && ts.isNamespaceImport(nb)) {
        if (spec !== null) bindings.set(nb.name.text, { spec, imported: "*", typeOnly: clauseType });
        const m = nsMembers(nb.name.text, null, clauseType);
        if (m.used) { syms.push(...m.syms); unresolved ||= m.unresolved; }
        else syms.push({ name: "*", use: clauseType ? "type" : "value" });
      } else if (nb && ts.isNamedImports(nb)) {
        for (const el of nb.elements) named(el.name.text, (el.propertyName ?? el.name).text, clauseType || el.isTypeOnly);
      }
      push("static", n.moduleSpecifier, n, syms, unresolved);
    } else if (ts.isExportDeclaration(n) && n.moduleSpecifier) {
      const spec = foldSpecifier(n.moduleSpecifier);
      const ec = n.exportClause;
      if (ec && ts.isNamedExports(ec)) {
        const syms: Sym[] = [];
        for (const el of ec.elements) {
          const src = nameText(el.propertyName ?? el.name) ?? "*";
          const typeOnly = n.isTypeOnly || el.isTypeOnly;
          syms.push({ name: src, use: typeOnly ? "type" : "value" });
          const exported = nameText(el.name);
          if (spec !== null && exported !== null) addHop(exported, { t: "from", spec, name: src, typeOnly });
        }
        push("export-from", n.moduleSpecifier, n, syms, false);
      } else {
        push("export-star", n.moduleSpecifier, n, [{ name: "*", use: n.isTypeOnly ? "type" : "value" }], false);
        if (spec !== null) {
          if (ec && ts.isNamespaceExport(ec)) {
            const exported = nameText(ec.name);
            if (exported !== null) addHop(exported, { t: "ns", spec, typeOnly: n.isTypeOnly });
          } else facts.stars.push({ spec, typeOnly: n.isTypeOnly });
        }
      }
    } else if (ts.isImportEqualsDeclaration(n) && ts.isExternalModuleReference(n.moduleReference)) {
      const spec = foldSpecifier(n.moduleReference.expression);
      if (spec !== null) bindings.set(n.name.text, { spec, imported: "*", typeOnly: n.isTypeOnly });
      const m = nsMembers(n.name.text, null, n.isTypeOnly);
      const syms = m.used ? m.syms : [{ name: "*", use: (n.isTypeOnly ? "type" : "value") as Use }];
      push("import-equals", n.moduleReference.expression, n, syms, m.unresolved);
    } else if (ts.isImportTypeNode(n)) {
      const a = n.argument;
      const lit = ts.isLiteralTypeNode(a) ? a.literal : undefined;
      let first: string | null = null;
      if (n.qualifier) {
        let q: ts.EntityName = n.qualifier;
        while (ts.isQualifiedName(q)) q = q.left;
        first = q.text;
      }
      push("import-type", lit ?? a, n, [{ name: first ?? "*", use: "type" }], first === null);
    } else if (ts.isCallExpression(n)) {
      const kind = importCallKind(n);
      if (!kind) continue;
      const arg = n.arguments[0];
      const spec = foldSpecifier(arg);
      const b = callBinding(n, spec, kind === "dynamic");
      push(kind, arg ?? n, n, b.syms, b.unresolved);
    }
  }

  // A loader reached other than by a direct call (aliased, passed on, require.cache, a factory result not bound to a
  // name) cannot be traced, so it is recorded as a non-literal require (NONLITERAL_IMPORT).
  const outerOf = (n: ts.Node) => {
    let c: ts.Node = n;
    while (c.parent && (ts.isParenthesizedExpression(c.parent) || ts.isAsExpression(c.parent) || ts.isNonNullExpression(c.parent) ||
      ts.isSatisfiesExpression(c.parent) || ts.isTypeAssertionExpression(c.parent))) c = c.parent;
    return c;
  };
  const calledBy = (n: ts.Node): ts.CallExpression | null => {
    const c = outerOf(n);
    return c.parent && ts.isCallExpression(c.parent) && c.parent.expression === c ? c.parent : null;
  };
  const boundToName = (n: ts.Node) => {
    const c = outerOf(n);
    return !!c.parent && ts.isVariableDeclaration(c.parent) && c.parent.initializer === c && ts.isIdentifier(c.parent.name);
  };
  for (const n of all) {
    let factory = false;
    if (ts.isIdentifier(n) && isRef(n) && !isTypePosition(n)) {
      factory = factories.has(n.text);
      if (!factory && n.text !== "require" && !createRequireIds.has(n.text)) continue;
    } else if (ts.isPropertyAccessExpression(n)) {
      factory = n.name.text === "createRequire";
      if (!factory && !globalRequire(n)) continue;
    } else continue;
    const call = calledBy(n);
    if (call && (!factory || calledBy(call) || boundToName(call))) continue;
    facts.imports.push({ kind: "require", spec: null, line: lineOf(n), text: snippet(outerOf(n).parent ?? n), syms: [{ name: "*", use: "value" }], nsUnresolved: true });
  }

  // Pass 3: exports, the re-export graph and declarations.
  function addHop(name: string, hop: Hop) {
    const l = facts.reexports.get(name);
    if (l) l.push(hop); else facts.reexports.set(name, [hop]);
    facts.exportedNames.add(name);
  }
  const localInit = new Map<string, ts.Expression>();
  for (const st of sf.statements) {
    if (ts.isVariableStatement(st)) for (const d of st.declarationList.declarations) {
      if (ts.isIdentifier(d.name) && d.initializer) localInit.set(d.name.text, d.initializer);
    }
  }
  // A literal-specifier import()/require() call behind await or parentheses, or null.
  const callSpec = (e: ts.Expression): string | null => {
    const u = unwrap(e);
    return ts.isCallExpression(u) && importCallKind(u) ? foldSpecifier(u.arguments[0]) : null;
  };
  // Member `name` of `obj`: exact for a namespace binding or a module call; otherwise the whole object is followed.
  const memberHops = (obj: ts.Expression, name: string | null, depth: number): Hop[] => {
    const o = unwrap(obj);
    const b = ts.isIdentifier(o) ? bindings.get(o.text) : undefined;
    if (b?.imported === "*" && name !== null) return [{ t: "from", spec: b.spec, name, typeOnly: b.typeOnly }];
    const spec = callSpec(o);
    if (spec !== null && name !== null) return [{ t: "from", spec, name, typeOnly: false }];
    return aliasHops(o, depth + 1);
  };
  const aliasHops = (e: ts.Expression | undefined, depth = 0): Hop[] => {
    if (!e || depth > 8) return [];
    e = unwrap(e);
    if (ts.isIdentifier(e)) {
      const b = bindings.get(e.text);
      if (b) return b.imported === "*" ? [{ t: "ns", spec: b.spec, typeOnly: b.typeOnly }] : [{ t: "from", spec: b.spec, name: b.imported, typeOnly: b.typeOnly }];
      return aliasHops(localInit.get(e.text), depth + 1);
    }
    if (ts.isPropertyAccessExpression(e)) return memberHops(e.expression, e.name.text, depth);
    if (ts.isElementAccessExpression(e)) return memberHops(e.expression, literalKey(e.argumentExpression), depth);
    if (ts.isObjectLiteralExpression(e)) {
      const out: Hop[] = [];
      for (const pr of e.properties) {
        if (ts.isShorthandPropertyAssignment(pr)) out.push(...aliasHops(pr.name, depth + 1));
        else if (ts.isPropertyAssignment(pr)) out.push(...aliasHops(pr.initializer, depth + 1));
        else if (ts.isSpreadAssignment(pr)) out.push(...aliasHops(pr.expression, depth + 1));
      }
      return out;
    }
    if (ts.isCallExpression(e)) {
      const spec = callSpec(e);
      if (spec !== null) return [{ t: "ns", spec, typeOnly: false }];
      const c = unwrap(e.expression);
      if (ts.isPropertyAccessExpression(c) && OBJECT_WRAPPERS.has(c.name.text) && ts.isIdentifier(c.expression) && c.expression.text === "Object") {
        return e.arguments.flatMap(a => aliasHops(a, depth + 1));
      }
      return [];
    }
    if (ts.isConditionalExpression(e)) return [...aliasHops(e.whenTrue, depth + 1), ...aliasHops(e.whenFalse, depth + 1)];
    if (ts.isBinaryExpression(e) && [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.AmpersandAmpersandToken].includes(e.operatorToken.kind)) {
      return [...aliasHops(e.left, depth + 1), ...aliasHops(e.right, depth + 1)];
    }
    return [];
  };
  const exportLocal = (exported: string, hops: Hop[]) => {
    facts.exportedNames.add(exported);
    for (const h of hops) addHop(exported, h);
  };
  // `export const { a, b: c } = init`: each bound name follows the matching member of init.
  const exportPattern = (pat: ts.BindingPattern, init: ts.Expression | undefined) => {
    for (const el of pat.elements) {
      if (!ts.isBindingElement(el)) continue;
      const key = ts.isObjectBindingPattern(pat) && !el.dotDotDotToken
        ? (el.propertyName ? nameText(el.propertyName) ?? literalKey(el.propertyName) : nameText(el.name))
        : null;
      const hops = init ? (key !== null ? memberHops(init, key, 0) : aliasHops(init)) : [];
      if (ts.isIdentifier(el.name)) exportLocal(el.name.text, hops);
      else exportPattern(el.name, init);
    }
  };
  // CommonJS `module.exports = x` / `export = x`: default plus every property of an object literal; a namespace
  // (require call or namespace binding) behaves like `export * from`.
  const exportWhole = (rhs: ts.Expression) => {
    const hops = aliasHops(rhs);
    exportLocal("default", hops);
    for (const h of hops) if (h.t === "ns") facts.stars.push({ spec: h.spec, typeOnly: h.typeOnly });
    const r = unwrap(rhs);
    if (ts.isObjectLiteralExpression(r)) for (const pr of r.properties) {
      if (ts.isShorthandPropertyAssignment(pr)) exportLocal(pr.name.text, aliasHops(pr.name));
      else if (ts.isPropertyAssignment(pr)) {
        const k = nameText(pr.name) ?? literalKey(pr.name);
        if (k !== null) exportLocal(k, aliasHops(pr.initializer));
      }
    }
  };
  const isModuleExports = (x: ts.Expression) =>
    ts.isPropertyAccessExpression(x) && x.name.text === "exports" && ts.isIdentifier(x.expression) && x.expression.text === "module";
  const hasMod = (n: ts.Node, k: ts.SyntaxKind) => !!(ts.canHaveModifiers(n) && ts.getModifiers(n)?.some(m => m.kind === k));
  for (const st of sf.statements) {
    const exp = hasMod(st, ts.SyntaxKind.ExportKeyword);
    const def = hasMod(st, ts.SyntaxKind.DefaultKeyword);
    if (ts.isVariableStatement(st) && exp) {
      for (const d of st.declarationList.declarations) {
        if (ts.isIdentifier(d.name)) exportLocal(d.name.text, aliasHops(d.initializer));
        else exportPattern(d.name, d.initializer);
      }
    } else if ((ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st) || ts.isInterfaceDeclaration(st) ||
      ts.isTypeAliasDeclaration(st) || ts.isEnumDeclaration(st) || ts.isModuleDeclaration(st)) && exp) {
      if (def) facts.exportedNames.add("default");
      else if (st.name && ts.isIdentifier(st.name)) facts.exportedNames.add(st.name.text);
    } else if (ts.isExportAssignment(st)) {
      if (st.isExportEquals) exportWhole(st.expression);
      else exportLocal("default", aliasHops(st.expression));
    } else if (ts.isExpressionStatement(st) && ts.isBinaryExpression(st.expression) && st.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const lhs = unwrap(st.expression.left);
      const rhs = st.expression.right;
      const onExports = (o: ts.Expression) => isModuleExports(o) || (ts.isIdentifier(o) && o.text === "exports");
      if (isModuleExports(lhs)) exportWhole(rhs);
      else if (ts.isPropertyAccessExpression(lhs) && onExports(unwrap(lhs.expression))) exportLocal(lhs.name.text, aliasHops(rhs));
      else if (ts.isElementAccessExpression(lhs) && onExports(unwrap(lhs.expression))) {
        const k = literalKey(lhs.argumentExpression);
        if (k !== null) exportLocal(k, aliasHops(rhs));
      }
    } else if (ts.isExportDeclaration(st) && !st.moduleSpecifier && st.exportClause && ts.isNamedExports(st.exportClause)) {
      for (const el of st.exportClause.elements) {
        const local = nameText(el.propertyName ?? el.name);
        const exported = nameText(el.name);
        if (local === null || exported === null) continue;
        const typeOnly = st.isTypeOnly || el.isTypeOnly;
        const hops = aliasHops(ts.factory.createIdentifier(local)).map(h => ({ ...h, typeOnly: h.typeOnly || typeOnly }));
        exportLocal(exported, hops);
      }
    }
  }

  // Declarations (S10 REPO_CLONE) and exported Maps (S8 STORE_EXPORT). Bindings initialised from an
  // import()/require() call or a namespace import are imports, not declarations.
  const importInit = (e: ts.Expression | undefined): boolean => {
    while (e && (ts.isParenthesizedExpression(e) || ts.isAwaitExpression(e) || ts.isAsExpression(e) || ts.isNonNullExpression(e))) e = e.expression;
    if (!e) return false;
    if (ts.isCallExpression(e)) return importCallKind(e) !== null;
    return ts.isIdentifier(e) && bindings.get(e.text)?.imported === "*";
  };
  const declOf = (n: ts.Node): ts.VariableDeclaration | null => {
    let p: ts.Node | undefined = n.parent;
    while (p && (ts.isObjectBindingPattern(p) || ts.isArrayBindingPattern(p) || ts.isBindingElement(p))) p = p.parent;
    return p && ts.isVariableDeclaration(p) ? p : null;
  };
  const mapVars = new Set<string>();
  for (const n of all) {
    let name: string | null = null;
    let kind = "";
    if (ts.isFunctionDeclaration(n) && n.name) { name = n.name.text; kind = "function"; }
    else if (ts.isClassDeclaration(n) && n.name) { name = n.name.text; kind = "class"; }
    else if (ts.isInterfaceDeclaration(n)) { name = n.name.text; kind = "interface"; }
    else if (ts.isTypeAliasDeclaration(n)) { name = n.name.text; kind = "type"; }
    else if (ts.isEnumDeclaration(n)) { name = n.name.text; kind = "enum"; }
    else if (ts.isMethodDeclaration(n)) { name = nameText(n.name); kind = "method"; }
    else if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && !importInit(n.initializer)) { name = n.name.text; kind = "variable"; }
    else if (ts.isBindingElement(n) && ts.isIdentifier(n.name) && !importInit(declOf(n)?.initializer)) { name = n.name.text; kind = "variable"; }
    if (name !== null) facts.decls.push({ name, kind, line: lineOf(n) });
  }
  for (const st of sf.statements) {
    if (!ts.isVariableStatement(st)) continue;
    for (const d of st.declarationList.declarations) {
      const init = d.initializer;
      if (ts.isIdentifier(d.name) && init && ts.isNewExpression(init) && ts.isIdentifier(init.expression) && init.expression.text === "Map") {
        mapVars.add(d.name.text);
      }
    }
  }
  const exportedMaps = new Set<string>();
  const returnsMap = (body: ts.Node | undefined): string | null => {
    if (!body) return null;
    if (ts.isIdentifier(body) && mapVars.has(body.text)) return body.text;
    let hit: string | null = null;
    const v = (n: ts.Node) => {
      if (hit) return;
      if (ts.isReturnStatement(n) && n.expression && ts.isIdentifier(n.expression) && mapVars.has(n.expression.text)) hit = n.expression.text;
      ts.forEachChild(n, v);
    };
    v(body);
    return hit;
  };
  for (const st of sf.statements) {
    const exp = hasMod(st, ts.SyntaxKind.ExportKeyword);
    if (ts.isVariableStatement(st) && exp) {
      for (const d of st.declarationList.declarations) {
        if (!ts.isIdentifier(d.name)) continue;
        if (mapVars.has(d.name.text)) exportedMaps.add(d.name.text);
        const init = d.initializer;
        if (init && ts.isIdentifier(init) && mapVars.has(init.text)) exportedMaps.add(init.text);
        if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) { const m = returnsMap(init.body); if (m) exportedMaps.add(m); }
      }
    } else if (ts.isFunctionDeclaration(st) && exp) {
      const m = returnsMap(st.body);
      if (m) exportedMaps.add(m);
    } else if (ts.isExportAssignment(st) && ts.isIdentifier(st.expression) && mapVars.has(st.expression.text)) {
      exportedMaps.add(st.expression.text);
    } else if (ts.isExportDeclaration(st) && !st.moduleSpecifier && st.exportClause && ts.isNamedExports(st.exportClause)) {
      for (const el of st.exportClause.elements) {
        const local = nameText(el.propertyName ?? el.name);
        if (local !== null && mapVars.has(local)) exportedMaps.add(local);
      }
    }
  }
  facts.exportedMaps = [...exportedMaps].sort();

  // Comments (every token's leading and trailing trivia) and string/template literals (S10 TABLE_SQL).
  const seen = new Set<number>();
  const addComment = (r: ts.CommentRange) => {
    if (seen.has(r.pos)) return;
    seen.add(r.pos);
    const raw = code.slice(r.pos, r.end);
    const start = sf.getLineAndCharacterOfPosition(r.pos).line + 1;
    raw.split("\n").forEach((l, i) => {
      const text = l.replace(/^\s*(\/\/+|\/\*+|\*+)?/, "").replace(/\*+\/\s*$/, "").trim();
      if (text) facts.comments.push({ line: start + i, text });
    });
  };
  const visitTokens = (n: ts.Node) => {
    ts.getLeadingCommentRanges(code, n.pos)?.forEach(addComment);
    ts.getTrailingCommentRanges(code, n.end)?.forEach(addComment);
    for (const c of n.getChildren(sf)) visitTokens(c);
  };
  visitTokens(sf);
  for (const n of all) {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) facts.literals.push({ line: lineOf(n), text: n.text });
    else if (ts.isTemplateExpression(n)) {
      facts.literals.push({ line: lineOf(n), text: n.head.text + n.templateSpans.map(s => " ? " + s.literal.text).join("") });
    }
  }
  return facts;
}
