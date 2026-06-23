// Parse the Day-1 quick-preview markdown table ("| Time | Spot | Tip |") into
// structured rows for the expandable preview cards (B3b). The quick preview API
// (api/ai-planner-quick.js) only returns time + spot + tip — no coordinates,
// photos, transit or addresses — so this is all the structured data we have.

export interface PreviewStop {
  time?: string;
  /** Korean/display spot name (preview table gives a single name column). */
  name: string;
  tip?: string;
}

/** Parse a markdown table string into preview stops. Tolerant of header /
 *  separator rows and column-count variation. Returns [] when the string isn't
 *  a usable table so the caller can fall back to raw rendering. */
export function parsePreviewTable(raw: string): PreviewStop[] {
  if (!raw || typeof raw !== 'string') return [];
  const lines = raw.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('|'));
  // Drop markdown separator rows like |---|---|.
  const dataLines = lines.filter((l) => !/^\|[\s:|-]+\|?$/.test(l));
  if (dataLines.length < 2) return [];
  const cells = (line: string) => line.split('|').map((c) => c.trim()).filter((c) => c.length > 0);
  const header = cells(dataLines[0]).map((h) => h.toLowerCase());
  // Locate columns by header keywords; fall back to positional 0/1/2.
  const findCol = (keys: string[], fallback: number) => {
    const idx = header.findIndex((h) => keys.some((k) => h.includes(k)));
    return idx >= 0 ? idx : fallback;
  };
  const timeCol = findCol(['time', '시간', '時間', '时间'], 0);
  const nameCol = findCol(['spot', 'place', '명소', '장소', 'スポット', '景点'], 1);
  const tipCol = findCol(['tip', 'insider', '팁', 'ヒント', '贴士'], 2);
  const out: PreviewStop[] = [];
  for (const line of dataLines.slice(1)) {
    const c = cells(line);
    const name = (c[nameCol] || '').trim();
    if (!name) continue;
    out.push({
      time: (c[timeCol] || '').trim() || undefined,
      name,
      tip: (c[tipCol] || '').trim() || undefined,
    });
  }
  return out;
}
