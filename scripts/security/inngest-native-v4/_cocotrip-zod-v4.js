// Inngest-private facade: 15 value-only sites and Remix's explicit key/value site.
import { z as nativeZod, ZodError } from 'zod/v4';

function record(keyOrValue, valueType) {
  const parser = arguments.length === 1
    ? nativeZod.record(nativeZod.string(), keyOrValue)
    : nativeZod.record(keyOrValue, valueType);
  const guarded = nativeZod.preprocess((input, ctx) => {
    // Native v4 skips this key before value validation; reject before it can disappear.
    // Only own keys are rejected. Ordinary constructor/prototype keys remain validated.
    if (input && typeof input === 'object' && Object.prototype.hasOwnProperty.call(input, '__proto__')) {
      ctx.addIssue({ code: 'custom', path: ['__proto__'], message: 'Unsafe record key' });
      return nativeZod.NEVER;
    }
    return input;
  }, parser);
  Object.defineProperties(guarded, {
    keyType: { value: parser.keyType },
    valueType: { value: parser.valueType },
  });
  return guarded;
}

const z = { ...nativeZod, record };
export { z, ZodError, record };
