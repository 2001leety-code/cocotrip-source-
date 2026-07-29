import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

type IndexDefinition = {
  collectionGroup?: string;
  fields?: Array<{ fieldPath?: string }>;
};

describe('firestore.indexes.json deployability', () => {
  it('does not declare single-field composite indexes', () => {
    const file = readFileSync(resolve(process.cwd(), 'firestore.indexes.json'), 'utf8');
    const parsed = JSON.parse(file) as { indexes?: IndexDefinition[] };
    const invalid = (parsed.indexes || []).filter((index) => (index.fields || []).length < 2);

    expect(invalid).toEqual([]);
  });
});
