const STRING_LITERAL = /'[^']*'/g;
const NUMERIC_LITERAL = /\b\d+(\.\d+)?\b/g;
const IN_CLAUSE_VALUES = /\bIN\s*\([^)]+\)/gi;
const BETWEEN_VALUES = /\bBETWEEN\s+\S+\s+AND\s+\S+/gi;

export function sanitizeQuery(sql: string): string {
  return sql
    .replace(IN_CLAUSE_VALUES, 'IN (?)')
    .replace(BETWEEN_VALUES, 'BETWEEN ? AND ?')
    .replace(STRING_LITERAL, "'?'")
    .replace(NUMERIC_LITERAL, '?');
}

const OPERATION_PATTERN = /^\s*(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|EXEC|EXECUTE|MERGE|UPSERT)\b/i;
const TABLE_FROM = /\bFROM\s+[\["`]?(\w+)[\]"`]?/i;
const TABLE_INTO = /\bINTO\s+[\["`]?(\w+)[\]"`]?/i;
const TABLE_UPDATE = /\bUPDATE\s+[\["`]?(\w+)[\]"`]?/i;
const TABLE_JOIN = /\bJOIN\s+[\["`]?(\w+)[\]"`]?/i;

export function extractOperation(sql: string): string {
  const match = sql.match(OPERATION_PATTERN);
  return match ? match[1].toUpperCase() : 'UNKNOWN';
}

export function extractTable(sql: string): string {
  const op = extractOperation(sql);

  if (op === 'UPDATE') {
    const match = sql.match(TABLE_UPDATE);
    if (match) return match[1];
  }

  if (op === 'INSERT') {
    const match = sql.match(TABLE_INTO);
    if (match) return match[1];
  }

  const fromMatch = sql.match(TABLE_FROM);
  if (fromMatch) return fromMatch[1];

  const joinMatch = sql.match(TABLE_JOIN);
  if (joinMatch) return joinMatch[1];

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
