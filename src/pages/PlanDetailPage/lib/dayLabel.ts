export interface DayLabelParts {
  prefix: string;
  number: string;
  suffix: string;
}

export function dayLabelParts(language: string, dayNumber: number): DayLabelParts {
  const number = String(dayNumber);
  switch (language) {
    case 'ko': return { prefix: '', number, suffix: '일차' };
    case 'ja': return { prefix: '', number, suffix: '日目' };
    case 'zh': return { prefix: '第', number, suffix: '天' };
    default: return { prefix: 'Day', number, suffix: '' };
  }
}

export function formatDayLabel(language: string, dayNumber: number): string {
  const { prefix, number, suffix } = dayLabelParts(language, dayNumber);
  return prefix === 'Day'
    ? `${prefix} ${number}`
    : `${prefix}${number}${suffix}`;
}
