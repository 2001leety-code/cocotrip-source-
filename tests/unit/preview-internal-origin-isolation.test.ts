import { afterEach, describe, expect, it, vi } from 'vitest';
import { internalApiBase, internalMoneyApiBase, publicSiteOrigin } from '../../api/_shared/internal-base-url.js';
afterEach(()=>vi.unstubAllEnvs());
describe('Preview self-call origin isolation',()=>{
  for(const fn of [internalApiBase,internalMoneyApiBase,publicSiteOrigin]){
    it.each(['','cocotripkr.com','https://cocotripkr.com','cocotripkr.vercel.app','x.vercel.app/path','x.vercel.app@cocotripkr.com'])(`${fn.name} blocks %s`,host=>{
      vi.stubEnv('VERCEL_ENV','preview');vi.stubEnv('VERCEL_URL',host);expect(()=>fn()).toThrow('PREVIEW_INTERNAL_ORIGIN_UNAVAILABLE');
    });
    it(`${fn.name} uses current preview and leaves production unchanged`,()=>{
      vi.stubEnv('VERCEL_ENV','preview');vi.stubEnv('VERCEL_URL','cocotrip-test-123.vercel.app');expect(fn()).toBe('https://cocotrip-test-123.vercel.app');
      vi.stubEnv('VERCEL_ENV','production');expect(fn()).toBe('https://cocotripkr.com');
    });
  }
});
