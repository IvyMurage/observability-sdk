const STRING_LITERAL = /'[^']*'/g;
const NUMERIC_LITERAL = /\b\d+(\.\d+)?\b/g;
const IN_CLAUSE_VALUES = /\bIN\s*\([^)]+\)/gi;
const BETWEEN_VALUES = /\bBETWEEN\s+\S+\s+AND\s+\S+/gi;
const SEQUELIZE_PREFIX = /^Executed\s*\([^)]*\)\s*:\s*/i;

function stripPrefix(sql: string): string {
  return sql.replace(SEQUELIZE_PREFIX, '').trimStart();
}

export function sanitizeQuery(sql: string): string {
  return sql
    .replace(IN_CLAUSE_VALUES, 'IN (?)')
    .replace(BETWEEN_VALUES, 'BETWEEN ? AND ?')
    .replace(STRING_LITERAL, "'?'")
    .replace(NUMERIC_LITERAL, '?');
}

const OPERATION_PATTERN = /^\s*(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|EXEC|EXECUTE|MERGE|UPSERT)\b/i;

const TABLE_FROM = /\bFROM\s+(?:\[(\w+)\]\.\[(\w+)\]|[\["`]?(\w+)[\]"`]?)/i;
const TABLE_INTO = /\bINTO\s+(?:\[(\w+)\]\.\[(\w+)\]|[\["`]?(\w+)[\]"`]?)/i;
const TABLE_UPDATE = /\bUPDATE\s+(?:\[(\w+)\]\.\[(\w+)\]|[\["`]?(\w+)[\]"`]?)/i;
const TABLE_JOIN = /\bJOIN\s+(?:\[(\w+)\]\.\[(\w+)\]|[\["`]?(\w+)[\]"`]?)/i;

function matchTable(match: RegExpMatchArray): string {
  return match[2] || match[3] || match[1];
}

export function extractOperation(sql: string): string {
  const clean = stripPrefix(sql);
  const match = clean.match(OPERATION_PATTERN);
  return match ? match[1].toUpperCase() : 'UNKNOWN';
}

export function extractTable(sql: string): string {
  const clean = stripPrefix(sql);
  const op = extractOperation(clean);

  if (op === 'UPDATE') {
    const match = clean.match(TABLE_UPDATE);
    if (match) return matchTable(match);
  }

  if (op === 'INSERT') {
    const match = clean.match(TABLE_INTO);
    if (match) return matchTable(match);
  }

  const fromMatch = clean.match(TABLE_FROM);
  if (fromMatch) return matchTable(fromMatch);

  const joinMatch = clean.match(TABLE_JOIN);
  if (joinMatch) return matchTable(joinMatch);

  return 'unknown';
}

export interface ParsedQuery {
  operation: string;
  table: string;
  sanitized?: string;
}

export function parseQuery(sql: string, captureSql: boolean = false): ParsedQuery {
  return {
    operation: extractOperation(sql),
    table: extractTable(sql),
    ...(captureSql && { sanitized: sanitizeQuery(sql) }),
  };
}
