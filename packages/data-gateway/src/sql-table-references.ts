export interface SqlTableReference {
  parts: string[];
}

export class SqlTableReferenceParseError extends Error {
  readonly code = "SQL_TABLE_REFERENCE_PARSE_ERROR";

  constructor(message: string, readonly position?: number) {
    super(position === undefined ? message : `${message} (at character ${position})`);
    this.name = "SqlTableReferenceParseError";
  }
}

type TokenKind = "identifier" | "literal" | "number" | "operator" | "symbol";

interface SqlToken {
  kind: TokenKind;
  value: string;
  quoted: boolean;
  position: number;
}

interface CteDefinition {
  name: string;
  queryStart: number;
  queryEnd: number;
}

const FROM_TERMINATORS = new Set([
  "except",
  "fetch",
  "for",
  "group",
  "having",
  "intersect",
  "limit",
  "offset",
  "order",
  "union",
  "where",
  "window",
]);

const SET_OPERATORS = new Set(["except", "intersect", "union"]);

const FACTOR_BOUNDARIES = new Set([
  ...FROM_TERMINATORS,
  "as",
  "cross",
  "full",
  "inner",
  "join",
  "left",
  "natural",
  "on",
  "outer",
  "right",
  "tablesample",
  "using",
]);

const INVALID_TABLE_STARTS = new Set([
  ...FACTOR_BOUNDARIES,
  "lateral",
  "only",
  "rows",
  "select",
  "table",
  "values",
  "with",
]);

/**
 * Extracts physical relation references from one PostgreSQL SELECT/WITH query.
 *
 * Unquoted identifiers are folded to lower case according to PostgreSQL rules.
 * Double-quoted identifiers are decoded and retain their case. The parser is
 * deliberately fail-closed for FROM items it cannot classify as a relation,
 * CTE, or subquery.
 */
export const parsePostgreSqlTableReferences = (sql: string): SqlTableReference[] => {
  const tokens = tokenize(sql);
  const statementTokens = withoutTrailingSemicolon(tokens);
  if (statementTokens.length === 0) {
    throw new SqlTableReferenceParseError("SQL is empty.");
  }

  const matchingParentheses = matchParentheses(statementTokens);
  const references = new Map<string, SqlTableReference>();
  const parser = new TableReferenceParser(statementTokens, matchingParentheses, references);
  parser.parseQuery(0, statementTokens.length, new Set());
  return [...references.values()];
};

class TableReferenceParser {
  constructor(
    private readonly tokens: SqlToken[],
    private readonly matchingParentheses: Map<number, number>,
    private readonly references: Map<string, SqlTableReference>,
  ) {}

  parseQuery(start: number, end: number, inheritedCtes: ReadonlySet<string>): void {
    const range = this.unwrapQueryRange(start, end);
    if (range.start >= range.end) {
      this.fail("Expected a SELECT query.", start);
    }

    let queryStart = range.start;
    const ctes = new Set(inheritedCtes);
    if (this.isKeyword(queryStart, "with")) {
      const withClause = this.parseWithClause(queryStart, range.end);
      if (withClause.recursive) {
        for (const definition of withClause.definitions) {
          ctes.add(definition.name);
        }
        for (const definition of withClause.definitions) {
          this.parseQuery(definition.queryStart, definition.queryEnd, ctes);
        }
      } else {
        for (const definition of withClause.definitions) {
          this.parseQuery(definition.queryStart, definition.queryEnd, ctes);
          ctes.add(definition.name);
        }
      }
      queryStart = withClause.queryStart;
    }

    if (!this.isKeyword(queryStart, "select") && !this.isKeyword(queryStart, "table")) {
      this.fail("Only SELECT/WITH queries can be inspected.", queryStart);
    }
    this.scanQueryBody(queryStart, range.end, ctes);
  }

  private parseWithClause(start: number, end: number): {
    definitions: CteDefinition[];
    queryStart: number;
    recursive: boolean;
  } {
    let index = start + 1;
    const recursive = this.isKeyword(index, "recursive");
    if (recursive) {
      index += 1;
    }

    const definitions: CteDefinition[] = [];
    while (index < end) {
      const name = this.requireIdentifier(index, "Expected a CTE name.");
      index += 1;

      if (this.isSymbol(index, "(")) {
        index = this.closeParenthesis(index, end) + 1;
      }
      this.requireKeyword(index, "as", "Expected AS after the CTE name.");
      index += 1;

      if (this.isKeyword(index, "not")) {
        this.requireKeyword(index + 1, "materialized", "Expected MATERIALIZED after NOT.");
        index += 2;
      } else if (this.isKeyword(index, "materialized")) {
        index += 1;
      }

      if (!this.isSymbol(index, "(")) {
        this.fail("Expected a parenthesized CTE query.", index);
      }
      const close = this.closeParenthesis(index, end);
      definitions.push({
        name: name.value,
        queryStart: index + 1,
        queryEnd: close,
      });
      index = close + 1;

      if (this.isSymbol(index, ",")) {
        index += 1;
        continue;
      }
      break;
    }

    if (definitions.length === 0) {
      this.fail("WITH must define at least one CTE.", start);
    }
    return { definitions, queryStart: index, recursive };
  }

  private scanQueryBody(start: number, end: number, ctes: ReadonlySet<string>): void {
    let index = this.isKeyword(start, "table")
      ? this.parseTableFactor(start + 1, end, ctes)
      : start;
    while (index < end) {
      if (this.isSetOperator(index)) {
        index = this.parseSetOperand(index, end, ctes);
        continue;
      }
      if (this.isStructuralKeyword(index, "from")) {
        index = this.parseFromClause(index + 1, end, ctes);
        continue;
      }
      if (this.isSymbol(index, "(")) {
        const close = this.closeParenthesis(index, end);
        this.scanExpressionForSubqueries(index + 1, close, ctes);
        index = close + 1;
        continue;
      }
      index += 1;
    }
  }

  private parseSetOperand(start: number, end: number, ctes: ReadonlySet<string>): number {
    let index = start + 1;
    if (this.isKeyword(index, "all") || this.isKeyword(index, "distinct")) {
      index += 1;
    }
    if (index >= end) {
      this.fail("Set operation must be followed by a query.", index);
    }

    if (this.isSymbol(index, "(")) {
      const close = this.closeParenthesis(index, end);
      const inner = this.unwrapQueryRange(index + 1, close);
      if (
        this.isKeyword(inner.start, "select")
        || this.isKeyword(inner.start, "table")
        || this.isKeyword(inner.start, "with")
      ) {
        this.parseQuery(index + 1, close, ctes);
      } else if (this.isKeyword(inner.start, "values")) {
        this.scanExpressionForSubqueries(index + 1, close, ctes);
      } else {
        this.fail("Unable to classify a set-operation query.", inner.start);
      }
      return close + 1;
    }

    if (this.isKeyword(index, "table")) {
      return this.parseTableFactor(index + 1, end, ctes);
    }
    if (
      this.isKeyword(index, "select")
      || this.isKeyword(index, "with")
      || this.isKeyword(index, "values")
    ) {
      return index;
    }
    this.fail("Unable to classify a set-operation query.", index);
  }

  private scanExpressionForSubqueries(start: number, end: number, ctes: ReadonlySet<string>): void {
    let index = start;
    while (index < end) {
      if (this.isSymbol(index, "(")) {
        const close = this.closeParenthesis(index, end);
        this.scanExpressionForSubqueries(index + 1, close, ctes);
        index = close + 1;
        continue;
      }
      if (index === start && (
        this.isKeyword(index, "select")
        || this.isTableQueryStart(index, end)
        || this.isKeyword(index, "with")
      )) {
        this.parseQuery(index, end, ctes);
        return;
      }
      index += 1;
    }
  }

  private parseFromClause(start: number, end: number, ctes: ReadonlySet<string>): number {
    if (start >= end || this.isFromTerminator(start)) {
      this.fail("FROM must be followed by a relation or subquery.", start);
    }

    let index = this.parseTableFactor(start, end, ctes);
    while (index < end) {
      if (this.isFromTerminator(index)) {
        return index;
      }
      if (this.isSymbol(index, ",")) {
        index = this.parseTableFactor(index + 1, end, ctes);
        continue;
      }

      const afterJoin = this.consumeJoinOperator(index, end);
      if (afterJoin !== undefined) {
        index = this.parseTableFactor(afterJoin, end, ctes);
        continue;
      }

      if (this.isStructuralKeyword(index, "on")) {
        index = this.skipJoinCondition(index + 1, end, ctes);
        continue;
      }
      if (this.isStructuralKeyword(index, "using")) {
        if (!this.isSymbol(index + 1, "(")) {
          this.fail("USING must be followed by a parenthesized column list.", index);
        }
        index = this.closeParenthesis(index + 1, end) + 1;
        continue;
      }

      this.fail("Unable to classify an item in the FROM clause.", index);
    }
    return index;
  }

  private parseTableFactor(start: number, end: number, ctes: ReadonlySet<string>): number {
    let index = start;
    if (index >= end) {
      this.fail("Expected a relation or subquery.", index);
    }

    if (this.isKeyword(index, "lateral")) {
      index += 1;
    }

    let onlyParenthesized = false;
    if (this.isKeyword(index, "only")) {
      index += 1;
      if (this.isSymbol(index, "(")) {
        onlyParenthesized = true;
        index += 1;
      }
    }

    if (this.isSymbol(index, "(")) {
      const close = this.closeParenthesis(index, end);
      const inner = this.unwrapQueryRange(index + 1, close);
      if (
        this.isKeyword(inner.start, "select")
        || this.isKeyword(inner.start, "table")
        || this.isKeyword(inner.start, "with")
      ) {
        this.parseQuery(index + 1, close, ctes);
      } else {
        this.parseFromClause(index + 1, close, ctes);
      }
      index = close + 1;
      return this.consumeAlias(index, end);
    }

    const first = this.requireIdentifier(index, "Expected a relation name.");
    if (!first.quoted && INVALID_TABLE_STARTS.has(first.value)) {
      this.fail("Unsupported or invalid FROM item.", index);
    }

    const parts = [first.value];
    index += 1;
    while (this.isSymbol(index, ".")) {
      const part = this.requireIdentifier(index + 1, "Expected an identifier after '.'.");
      parts.push(part.value);
      index += 2;
    }

    if (this.isSymbol(index, "(")) {
      this.fail("Table functions in FROM are not supported.", index);
    }
    if (onlyParenthesized) {
      if (!this.isSymbol(index, ")")) {
        this.fail("Expected ')' after the ONLY relation.", index);
      }
      index += 1;
    }
    if (this.isOperator(index, "*")) {
      index += 1;
    }

    if (parts.length > 1 || !ctes.has(parts[0] ?? "")) {
      this.addReference(parts);
    }
    return this.consumeAlias(index, end);
  }

  private consumeAlias(start: number, end: number): number {
    let index = start;
    let consumedAlias = false;
    if (this.isKeyword(index, "as")) {
      const alias = this.requireIdentifier(index + 1, "Expected an alias after AS.");
      if (!alias.quoted && FACTOR_BOUNDARIES.has(alias.value)) {
        this.fail("Expected an alias after AS.", index + 1);
      }
      index += 2;
      consumedAlias = true;
    } else {
      const token = this.tokens[index];
      if (token?.kind === "identifier" && (token.quoted || !FACTOR_BOUNDARIES.has(token.value))) {
        index += 1;
        consumedAlias = true;
      }
    }

    if (consumedAlias && this.isSymbol(index, "(")) {
      index = this.closeParenthesis(index, end) + 1;
    }
    if (this.isKeyword(index, "tablesample")) {
      this.fail("TABLESAMPLE in FROM is not supported.", index);
    }
    return index;
  }

  private skipJoinCondition(start: number, end: number, ctes: ReadonlySet<string>): number {
    if (start >= end) {
      this.fail("ON must be followed by a join condition.", start);
    }

    let index = start;
    let sawToken = false;
    while (index < end) {
      if (this.isFromTerminator(index) || this.isSymbol(index, ",") || this.consumeJoinOperator(index, end) !== undefined) {
        if (!sawToken) {
          this.fail("ON must be followed by a join condition.", start);
        }
        return index;
      }
      if (this.isSymbol(index, "(")) {
        const close = this.closeParenthesis(index, end);
        this.scanExpressionForSubqueries(index + 1, close, ctes);
        index = close + 1;
        sawToken = true;
        continue;
      }
      index += 1;
      sawToken = true;
    }
    return index;
  }

  private consumeJoinOperator(start: number, end: number): number | undefined {
    if (this.isStructuralKeyword(start, "join")) {
      return start + 1;
    }

    let index = start;
    if (this.isStructuralKeyword(index, "natural")) {
      index += 1;
    }
    if (
      this.isStructuralKeyword(index, "inner")
      || this.isStructuralKeyword(index, "cross")
      || this.isStructuralKeyword(index, "left")
      || this.isStructuralKeyword(index, "right")
      || this.isStructuralKeyword(index, "full")
    ) {
      index += 1;
      if (this.isStructuralKeyword(index, "outer")) {
        index += 1;
      }
    } else if (index === start) {
      return undefined;
    }

    if (index >= end || !this.isStructuralKeyword(index, "join")) {
      return undefined;
    }
    return index + 1;
  }

  private unwrapQueryRange(start: number, end: number): { start: number; end: number } {
    let unwrappedStart = start;
    let unwrappedEnd = end;
    while (this.isSymbol(unwrappedStart, "(")) {
      const close = this.matchingParentheses.get(unwrappedStart);
      if (close !== unwrappedEnd - 1) {
        break;
      }
      unwrappedStart += 1;
      unwrappedEnd = close;
    }
    return { start: unwrappedStart, end: unwrappedEnd };
  }

  private closeParenthesis(open: number, rangeEnd: number): number {
    const close = this.matchingParentheses.get(open);
    if (close === undefined || close >= rangeEnd) {
      this.fail("Unclosed or out-of-range parenthesis.", open);
    }
    return close;
  }

  private addReference(parts: string[]): void {
    const key = JSON.stringify(parts);
    if (!this.references.has(key)) {
      this.references.set(key, { parts });
    }
  }

  private isFromTerminator(index: number): boolean {
    const token = this.tokens[index];
    return token?.kind === "identifier"
      && !token.quoted
      && !this.isSymbol(index - 1, ".")
      && FROM_TERMINATORS.has(token.value);
  }

  private isSetOperator(index: number): boolean {
    const token = this.tokens[index];
    return token?.kind === "identifier"
      && !token.quoted
      && !this.isSymbol(index - 1, ".")
      && !this.isKeyword(index - 1, "as")
      && SET_OPERATORS.has(token.value);
  }

  private isStructuralKeyword(index: number, value: string): boolean {
    return this.isKeyword(index, value)
      && !this.isSymbol(index - 1, ".")
      && !this.isKeyword(index - 1, "as");
  }

  private isTableQueryStart(index: number, end: number): boolean {
    if (!this.isKeyword(index, "table") || index + 1 >= end) {
      return false;
    }
    const next = this.tokens[index + 1];
    return next?.kind === "identifier" || this.isSymbol(index + 1, "(");
  }

  private requireIdentifier(index: number, message: string): SqlToken {
    const token = this.tokens[index];
    if (token?.kind !== "identifier") {
      this.fail(message, index);
    }
    return token;
  }

  private requireKeyword(index: number, value: string, message: string): void {
    if (!this.isKeyword(index, value)) {
      this.fail(message, index);
    }
  }

  private isKeyword(index: number, value: string): boolean {
    const token = this.tokens[index];
    return token?.kind === "identifier" && !token.quoted && token.value === value;
  }

  private isSymbol(index: number, value: string): boolean {
    const token = this.tokens[index];
    return token?.kind === "symbol" && token.value === value;
  }

  private isOperator(index: number, value: string): boolean {
    const token = this.tokens[index];
    return token?.kind === "operator" && token.value === value;
  }

  private fail(message: string, tokenIndex: number): never {
    const position = this.tokens[tokenIndex]?.position ?? this.tokens.at(-1)?.position ?? 0;
    throw new SqlTableReferenceParseError(message, position);
  }
}

const tokenize = (sql: string): SqlToken[] => {
  const tokens: SqlToken[] = [];
  let index = 0;

  while (index < sql.length) {
    const char = sql[index] ?? "";
    const next = sql[index + 1] ?? "";
    if (/\s/u.test(char)) {
      index += 1;
      continue;
    }

    if (char === "-" && next === "-") {
      index += 2;
      while (index < sql.length && sql[index] !== "\n" && sql[index] !== "\r") {
        index += 1;
      }
      continue;
    }
    if (char === "/" && next === "*") {
      index = skipBlockComment(sql, index);
      continue;
    }
    if ((char === "e" || char === "E") && next === "'") {
      const end = scanSingleQuotedLiteral(sql, index + 1, true);
      tokens.push({ kind: "literal", value: sql.slice(index, end), quoted: true, position: index });
      index = end;
      continue;
    }
    if ((char === "u" || char === "U") && next === "&" && sql[index + 2] === "'") {
      const end = scanSingleQuotedLiteral(sql, index + 2, true);
      tokens.push({ kind: "literal", value: sql.slice(index, end), quoted: true, position: index });
      index = end;
      continue;
    }
    if (char === "'") {
      const end = scanSingleQuotedLiteral(sql, index, false);
      tokens.push({ kind: "literal", value: sql.slice(index, end), quoted: true, position: index });
      index = end;
      continue;
    }
    if (char === '"') {
      const quoted = scanQuotedIdentifier(sql, index);
      tokens.push({ kind: "identifier", value: quoted.value, quoted: true, position: index });
      index = quoted.end;
      continue;
    }
    if (char === "$") {
      const dollarEnd = scanDollarQuotedLiteral(sql, index);
      if (dollarEnd !== undefined) {
        tokens.push({ kind: "literal", value: sql.slice(index, dollarEnd), quoted: true, position: index });
        index = dollarEnd;
        continue;
      }
    }
    if (isIdentifierStart(char)) {
      let end = index + 1;
      while (end < sql.length && isIdentifierContinuation(sql[end] ?? "")) {
        end += 1;
      }
      tokens.push({
        kind: "identifier",
        value: sql.slice(index, end).toLocaleLowerCase("en-US"),
        quoted: false,
        position: index,
      });
      index = end;
      continue;
    }
    if (/[0-9]/u.test(char)) {
      let end = index + 1;
      while (end < sql.length && /[0-9A-Za-z_.]/u.test(sql[end] ?? "")) {
        end += 1;
      }
      tokens.push({ kind: "number", value: sql.slice(index, end), quoted: false, position: index });
      index = end;
      continue;
    }
    if (char === "(" || char === ")" || char === "," || char === "." || char === ";") {
      tokens.push({ kind: "symbol", value: char, quoted: false, position: index });
      index += 1;
      continue;
    }

    tokens.push({ kind: "operator", value: char, quoted: false, position: index });
    index += 1;
  }
  return tokens;
};

const skipBlockComment = (sql: string, start: number): number => {
  let depth = 1;
  let index = start + 2;
  while (index < sql.length) {
    if (sql[index] === "/" && sql[index + 1] === "*") {
      depth += 1;
      index += 2;
      continue;
    }
    if (sql[index] === "*" && sql[index + 1] === "/") {
      depth -= 1;
      index += 2;
      if (depth === 0) {
        return index;
      }
      continue;
    }
    index += 1;
  }
  throw new SqlTableReferenceParseError("Unclosed block comment.", start);
};

const scanSingleQuotedLiteral = (sql: string, start: number, backslashEscapes: boolean): number => {
  let index = start + 1;
  while (index < sql.length) {
    if (backslashEscapes && sql[index] === "\\") {
      index += 2;
      continue;
    }
    if (sql[index] === "'" && sql[index + 1] === "'") {
      index += 2;
      continue;
    }
    if (sql[index] === "'") {
      return index + 1;
    }
    index += 1;
  }
  throw new SqlTableReferenceParseError("Unclosed string literal.", start);
};

const scanQuotedIdentifier = (sql: string, start: number): { value: string; end: number } => {
  let value = "";
  let index = start + 1;
  while (index < sql.length) {
    if (sql[index] === '"' && sql[index + 1] === '"') {
      value += '"';
      index += 2;
      continue;
    }
    if (sql[index] === '"') {
      return { value, end: index + 1 };
    }
    value += sql[index];
    index += 1;
  }
  throw new SqlTableReferenceParseError("Unclosed quoted identifier.", start);
};

const scanDollarQuotedLiteral = (sql: string, start: number): number | undefined => {
  const delimiterMatch = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/u.exec(sql.slice(start));
  const delimiter = delimiterMatch?.[0];
  if (!delimiter) {
    return undefined;
  }
  const close = sql.indexOf(delimiter, start + delimiter.length);
  if (close < 0) {
    throw new SqlTableReferenceParseError("Unclosed dollar-quoted literal.", start);
  }
  return close + delimiter.length;
};

const withoutTrailingSemicolon = (tokens: SqlToken[]): SqlToken[] => {
  const statement = [...tokens];
  if (statement.at(-1)?.kind === "symbol" && statement.at(-1)?.value === ";") {
    statement.pop();
  }
  const extraSemicolon = statement.find((token) => token.kind === "symbol" && token.value === ";");
  if (extraSemicolon) {
    throw new SqlTableReferenceParseError("Multiple SQL statements are not supported.", extraSemicolon.position);
  }
  return statement;
};

const matchParentheses = (tokens: SqlToken[]): Map<number, number> => {
  const pairs = new Map<number, number>();
  const stack: number[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token?.kind !== "symbol") {
      continue;
    }
    if (token.value === "(") {
      stack.push(index);
    } else if (token.value === ")") {
      const open = stack.pop();
      if (open === undefined) {
        throw new SqlTableReferenceParseError("Unexpected closing parenthesis.", token.position);
      }
      pairs.set(open, index);
    }
  }
  const unclosed = stack.at(-1);
  if (unclosed !== undefined) {
    throw new SqlTableReferenceParseError("Unclosed parenthesis.", tokens[unclosed]?.position);
  }
  return pairs;
};

const isIdentifierStart = (char: string): boolean => /[A-Za-z_\u0080-\uFFFF]/u.test(char);

const isIdentifierContinuation = (char: string): boolean => /[A-Za-z0-9_$\u0080-\uFFFF]/u.test(char);
