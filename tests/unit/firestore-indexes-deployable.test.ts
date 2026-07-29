import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  canonicalIndex,
  findMissingCompositeIndexes,
  toRestCompositeIndex,
  unionSingleFieldIndexes,
} from '../../scripts/deploy-firestore-indexes-rest.mjs';

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

  it('ignores Firestore generated __name__ fields when comparing indexes', () => {
    const declared = {
      collectionGroup: 'intent_classifier_logs',
      queryScope: 'COLLECTION',
      fields: [
        { fieldPath: 'used_llm_fallback', order: 'ASCENDING' },
        { fieldPath: 'ts', order: 'DESCENDING' },
      ],
    };
    const deployed = {
      name: 'projects/demo/databases/(default)/collectionGroups/intent_classifier_logs/indexes/abc',
      queryScope: 'COLLECTION',
      fields: [
        { fieldPath: 'used_llm_fallback', order: 'ASCENDING' },
        { fieldPath: 'ts', order: 'DESCENDING' },
        { fieldPath: '__name__', order: 'DESCENDING' },
      ],
    };

    expect(canonicalIndex(declared)).toBe(canonicalIndex(deployed));
    expect(findMissingCompositeIndexes([declared], [deployed])).toEqual([]);
  });

  it('maps composite array indexes to the Firestore Admin API body', () => {
    expect(toRestCompositeIndex({
      collectionGroup: 'user_painpoints',
      queryScope: 'COLLECTION',
      fields: [
        { fieldPath: 'detected_regions', arrayConfig: 'CONTAINS' },
        { fieldPath: 'score', order: 'DESCENDING' },
      ],
    })).toEqual({
      queryScope: 'COLLECTION',
      fields: [
        { fieldPath: 'detected_regions', arrayConfig: 'CONTAINS' },
        { fieldPath: 'score', order: 'DESCENDING' },
      ],
    });
  });

  it('adds single-field overrides without deleting existing index modes', () => {
    const override = {
      collectionGroup: 'coupons',
      fieldPath: 'source',
      indexes: [{ order: 'ASCENDING', queryScope: 'COLLECTION_GROUP' }],
    };
    const current = [{
      queryScope: 'COLLECTION',
      fields: [{ fieldPath: 'source', order: 'DESCENDING' }],
    }];

    expect(unionSingleFieldIndexes(override, current)).toEqual([
      current[0],
      {
        queryScope: 'COLLECTION_GROUP',
        fields: [{ fieldPath: 'source', order: 'ASCENDING' }],
      },
    ]);
  });

  it('strips output-only fields before patching a single-field override', () => {
    const override = {
      collectionGroup: 'coupons',
      fieldPath: 'source',
      indexes: [{ order: 'ASCENDING', queryScope: 'COLLECTION_GROUP' }],
    };
    const current = [{
      name: 'projects/demo/databases/(default)/collectionGroups/coupons/indexes/abc',
      state: 'READY',
      queryScope: 'COLLECTION_GROUP',
      fields: [{ fieldPath: 'source', order: 'ASCENDING' }],
    }];

    expect(unionSingleFieldIndexes(override, current)).toEqual([{
      queryScope: 'COLLECTION_GROUP',
      fields: [{ fieldPath: 'source', order: 'ASCENDING' }],
    }]);
  });
});
