// @vitest-environment jsdom
import {expect,it,vi} from 'vitest';
it('does not overwrite an existing scope when a storage read is temporarily denied',async()=>{
  vi.resetModules();localStorage.clear();
  const {rememberAiCheckoutScope,readAiCheckoutScope}=await import('../../src/lib/aiCheckoutScope');
  const a={uid:'owner-a',orderId:'immutable-order',attemptId:'a'};
  rememberAiCheckoutScope(a);
  vi.resetModules();const otherTab=await import('../../src/lib/aiCheckoutScope');
  const spy=vi.spyOn(Storage.prototype,'getItem');spy.mockImplementationOnce(()=>{throw new Error('synthetic read denial');});
  otherTab.rememberAiCheckoutScope({...a,uid:'owner-b',attemptId:'b'});
  spy.mockRestore();expect(readAiCheckoutScope(a.orderId)).toEqual(a);expect(otherTab.readAiCheckoutScope(a.orderId)).toEqual(a);
});
