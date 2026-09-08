/** Pure, in-memory filtering of already loaded summaries. No body reads or requests. */
export function selectInboxMessages<
  T extends {
    id: string;
    channel: 'email' | 'whatsapp';
    sourceAtMs: number;
    sender: string;
    subject: string;
  }
>(
  messages: readonly T[],
  filter: { channel: 'all' | 'email' | 'whatsapp'; query: string; order: 'newest' | 'oldest' }
): T[] {
  const query = (filter.query || '').trim().normalize('NFC').slice(0, 160).toLowerCase();
  const matches = messages.filter(message => {
    if (filter.channel !== 'all' && message.channel !== filter.channel) return false;
    if (query.length === 0) return true;
    const sender = (message.sender || '').normalize('NFC').toLowerCase();
    const subject = (message.subject || '').normalize('NFC').toLowerCase();
    return sender.includes(query) || subject.includes(query);
  });
  return matches
    .map((message, index) => ({ message, index }))
    .sort((a, b) => {
      const delta = filter.order === 'newest'
        ? b.message.sourceAtMs - a.message.sourceAtMs : a.message.sourceAtMs - b.message.sourceAtMs;
      return delta || a.index - b.index;
    })
    .map(entry => entry.message);
}
