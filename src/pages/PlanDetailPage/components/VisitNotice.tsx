import { visitNotice } from '@/lib/visitNotice.js';

export function VisitNotice({ language, input }: { language: string; input?: object }) {
  const notice = visitNotice(language, input);
  return <aside aria-label={notice.title} className="mb-4 rounded-ec-md border border-ec-line bg-ec-sunken p-3 text-ec-ink">
    <h2 className="text-sm font-semibold">{notice.title}</h2>
    <ul className="mt-3 space-y-4">
      {notice.items.map((item) => <li key={item.title}>
        <h3 className="text-[15px] font-semibold leading-relaxed md:text-base">{item.title}</h3>
        <p className="mt-1 text-[15px] font-normal leading-relaxed md:text-base">{item.body}</p>
      </li>)}
    </ul>
  </aside>;
}
