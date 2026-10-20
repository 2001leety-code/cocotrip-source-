/**
 * LLM 공급자 전환 (2026-10-13): Gemini responseSchema(OpenAPI subset, 대문자 type,
 * propertyOrdering) → Claude structured output JSON Schema 변환 계약.
 */
import { describe, it, expect } from 'vitest';
import { geminiSchemaToJsonSchema } from '../../api/_shared/llm/schema.js';

describe('geminiSchemaToJsonSchema', () => {
  it('lowercases types, drops propertyOrdering, adds additionalProperties:false on every object', () => {
    const out = geminiSchemaToJsonSchema({
      type: 'OBJECT',
      propertyOrdering: ['a', 'b'],
      required: ['a'],
      properties: {
        a: { type: 'STRING' },
        b: { type: 'INTEGER' },
        c: { type: 'NUMBER' },
        d: { type: 'BOOLEAN' },
      },
    });
    expect(out).toEqual({
      type: 'object',
      required: ['a'],
      additionalProperties: false,
      properties: {
        a: { type: 'string' },
        b: { type: 'integer' },
        c: { type: 'number' },
        d: { type: 'boolean' },
      },
    });
    expect(out).not.toHaveProperty('propertyOrdering');
  });

  it('converts nested ARRAY items and nested OBJECTs recursively', () => {
    const out = geminiSchemaToJsonSchema({
      type: 'OBJECT',
      properties: {
        days: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            propertyOrdering: ['day', 'stops'],
            required: ['day'],
            properties: {
              day: { type: 'INTEGER' },
              stops: { type: 'ARRAY', items: { type: 'OBJECT', properties: { name: { type: 'STRING' } } } },
            },
          },
        },
      },
    });
    const day = out.properties.days.items;
    expect(out.properties.days.type).toBe('array');
    expect(day.type).toBe('object');
    expect(day.additionalProperties).toBe(false);
    expect(day).not.toHaveProperty('propertyOrdering');
    expect(day.properties.stops.items.additionalProperties).toBe(false);
    expect(day.properties.stops.items.properties.name.type).toBe('string');
  });

  it('keeps description/enum/nullable passthrough fields', () => {
    const out = geminiSchemaToJsonSchema({
      type: 'STRING', description: 'd', enum: ['x', 'y'],
    });
    expect(out).toEqual({ type: 'string', description: 'd', enum: ['x', 'y'] });
  });

  it('converts the real PLAN_RESPONSE_SCHEMA without leaving any uppercase type or propertyOrdering', async () => {
    const mod = await import('../../api/_ai_core/geminiPipeline.js' as string);
    const out = geminiSchemaToJsonSchema(mod.PLAN_RESPONSE_SCHEMA);
    const json = JSON.stringify(out);
    expect(json).not.toMatch(/"type":"[A-Z]+"/);
    expect(json).not.toContain('propertyOrdering');
    // every object node closed
    type SchemaNode = { type?: string; additionalProperties?: boolean; properties?: Record<string, SchemaNode>; items?: SchemaNode };
    const walk = (node: SchemaNode | undefined) => {
      if (!node || typeof node !== 'object') return;
      if (node.type === 'object') expect(node.additionalProperties).toBe(false);
      if (node.properties) Object.values(node.properties).forEach(walk);
      if (node.items) walk(node.items);
    };
    walk(out);
    expect(out.required).toEqual(['days', 'arrival_guide', 'departure_guide']);
  });
});
