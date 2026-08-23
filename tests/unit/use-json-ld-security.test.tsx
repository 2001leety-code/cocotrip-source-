// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';
import { serializeJsonLd, useJsonLd } from '../../src/hooks/useJsonLd';

afterEach(() => {
  cleanup();
  document.head.querySelectorAll('script[type="application/ld+json"]').forEach((node) => node.remove());
});

describe('JSON-LD HTML 재파싱 안전 직렬화', () => {
  it('악성 </script> 값은 HTML 종료 태그가 되지 않지만 JSON 원문 의미는 보존한다', () => {
    const malicious = '</script><script>globalThis.__jsonLdXss = true</script>\u2028&';
    const serialized = serializeJsonLd({ headline: malicious });

    expect(serialized).not.toContain('<');
    expect(serialized).not.toContain('>');
    expect(serialized).not.toContain('&');
    expect(serialized).toContain('\\u003c/script\\u003e');
    expect(JSON.parse(serialized)).toEqual({ headline: malicious });
  });

  it('hook도 안전 문자열 하나만 application/ld+json text로 넣는다', () => {
    const malicious = '</script><img src=x onerror=alert(1)>';
    renderHook(() => useJsonLd('malicious-guide-jsonld', { headline: malicious }));

    const script = document.getElementById('malicious-guide-jsonld');
    expect(script?.textContent).not.toContain('<');
    expect(document.head.querySelectorAll('#malicious-guide-jsonld')).toHaveLength(1);
    expect(JSON.parse(script?.textContent || '{}')).toEqual({ headline: malicious });
    expect(document.head.innerHTML).not.toContain('</script><img');
  });
});
