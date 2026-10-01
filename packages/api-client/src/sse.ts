import type { AgentSseEvent } from '@moment/dto';

const KNOWN_EVENTS = new Set(['status', 'token', 'moments', 'navigate', 'error', 'done']);

/** 跨分片缓冲，按空行切事件。忽略注释，丢掉未知事件和坏 JSON。 */
export function createSseParser(): { push(chunk: string): AgentSseEvent[] } {
  let buffer = '';
  return {
    push(chunk: string): AgentSseEvent[] {
      buffer += chunk;
      buffer = buffer.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      const events: AgentSseEvent[] = [];
      let sep = buffer.indexOf('\n\n');
      while (sep >= 0) {
        const raw = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const event = parseFrame(raw);
        if (event) events.push(event);
        sep = buffer.indexOf('\n\n');
      }
      return events;
    },
  };
}

function parseFrame(raw: string): AgentSseEvent | null {
  let eventName = 'message';
  const dataLines: string[] = [];
  for (const line of raw.split('\n')) {
    if (line.length === 0 || line.startsWith(':')) continue;
    if (line.startsWith('event:')) {
      eventName = line.slice('event:'.length).trim();
      continue;
    }
    if (line.startsWith('data:')) {
      let value = line.slice('data:'.length);
      if (value.startsWith(' ')) value = value.slice(1);
      dataLines.push(value);
    }
  }
  if (!KNOWN_EVENTS.has(eventName) || dataLines.length === 0) return null;
  try {
    const data = JSON.parse(dataLines.join('\n')) as AgentSseEvent['data'];
    return { event: eventName, data } as AgentSseEvent;
  } catch {
    return null;
  }
}
