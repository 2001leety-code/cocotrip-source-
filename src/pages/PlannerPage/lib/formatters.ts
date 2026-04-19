// Pure formatting helpers -- extracted from legacy PlannerPage.tsx.
import { DATE_LOCALE } from '../constants';

export function formatDate(dateStr: string, lang: string) {
  return new Date(dateStr).toLocaleDateString(DATE_LOCALE[lang] ?? 'en-US', {
    month: 'long', day: 'numeric', weekday: 'short',
  });
}

// City name to API area key conversion
export function cityNameToAreaKey(cityName: string): string {
  const name = (cityName || '').toLowerCase().trim();
  if (name.includes('seoul')) return 'seoul_city';
  if (name.includes('busan')) return 'busan';
  if (name.includes('jeju')) return 'jeju';
  if (name.includes('gyeongju')) return 'gyeongju';
  if (name.includes('incheon')) return 'incheon';
  if (name.includes('suwon')) return 'suwon';
  if (name.includes('jeonju')) return 'jeonju';
  if (name.includes('gangneung')) return 'gangneung';
  if (name.includes('yeosu')) return 'yeosu';
  if (name.includes('daegu')) return 'daegu';
  if (name.includes('daejeon')) return 'daejeon';
  if (name.includes('gwangju')) return 'gwangju';
  return name || 'seoul_city';
}
