import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const dbDir = dirname(fileURLToPath(import.meta.url));
const schemaPath = resolve(dbDir, 'schema.ts');
const supportPaths = [
  resolve(dbDir, 'runtimeSchemaBootstrap.ts'),
  resolve(dbDir, 'siteSchemaCompatibility.ts'),
  resolve(dbDir, 'routeGroupingSchemaCompatibility.ts'),
  resolve(dbDir, 'proxyFileSchemaCompatibility.ts'),
  resolve(dbDir, 'accountTokenSchemaCompatibility.ts'),
  resolve(dbDir, 'sharedIndexSchemaCompatibility.ts'),
];

function extractAllMatches(content: string, pattern: RegExp): string[] {
  return Array.from(content.matchAll(pattern), (match) => match[1]);
}

describe('database schema parity', () => {
  it('keeps external runtime table support in sync with schema.ts', () => {
    const schemaContent = readFileSync(schemaPath, 'utf8');
    const supportContent = supportPaths
      .map((filePath) => readFileSync(filePath, 'utf8'))
      .join('\n');

    const schemaTables = extractAllMatches(schemaContent, /sqliteTable\('([^']+)'/g);
    const missingTables = schemaTables.filter((tableName) => !supportContent.includes(tableName));

    expect(missingTables).toEqual([]);
  });

  it('keeps external runtime index support in sync with schema.ts', () => {
    const schemaContent = readFileSync(schemaPath, 'utf8');
    const supportContent = supportPaths
      .map((filePath) => readFileSync(filePath, 'utf8'))
      .join('\n');

    const schemaIndexes = extractAllMatches(schemaContent, /(?:uniqueIndex|index)\('([^']+)'/g);
    const missingIndexes = schemaIndexes.filter((indexName) => !supportContent.includes(indexName));

    expect(missingIndexes).toEqual([]);
  });
});
