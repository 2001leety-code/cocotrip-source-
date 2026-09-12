import type { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { LanguageProvider, type LanguageScope } from '@/hooks/useLanguage';

/** The owner's controller must not inherit a customer's last selected language. */
export function RouteLanguageProvider({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const scope: LanguageScope = pathname === '/admin' || pathname.startsWith('/admin/') ? 'admin' : 'customer';
  // Re-read the correct preference when crossing the admin/customer boundary,
  // including SPA navigation. Ordinary navigation inside either scope is stable.
  return <LanguageProvider key={scope} scope={scope}>{children}</LanguageProvider>;
}
