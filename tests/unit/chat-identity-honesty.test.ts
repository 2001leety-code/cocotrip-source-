import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
const source = readFileSync('api/chat.js', 'utf8');
describe('chat identity honesty contract', () => {
  it('keeps a natural tone without a fabricated human identity or experience', () => {
    expect(source).toContain("CocoTrip Korea's AI travel assistant");
    expect(source).toContain('If asked whether you are AI, answer honestly');
    expect(source).not.toContain("You're not a chatbot");
    expect(source).not.toContain("You've been guiding foreign visitors around Korea for 10 years");
  });
});
