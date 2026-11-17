import type { ChannelMessage } from "./contracts";
import { threadReference } from "./thread-reference";

function descendants(
  parents: readonly { id: string; parent?: string | undefined }[],
  anchor: string,
) {
  const children = new Map<string, string[]>();
  for (const row of parents) {
    if (!row.parent) continue;
    const siblings = children.get(row.parent) ?? [];
    siblings.push(row.id);
    children.set(row.parent, siblings);
  }
  const ids = new Set([anchor]);
  for (const id of ids)
    for (const child of children.get(id) ?? []) ids.add(child);
  return ids;
}

/** Only established ancestry belongs to a branch. Missing parents stay hidden. */
export function subthreadEvents<
  T extends { id: string; tags: readonly (readonly string[])[] },
>(events: readonly T[], anchor: string) {
  const ids = descendants(
    events.map((event) => ({
      id: event.id,
      parent: threadReference(event)?.parentId,
    })),
    anchor,
  );
  return events.filter((event) => ids.has(event.id));
}

export function subthreadMessages(
  rows: readonly ChannelMessage[],
  anchor: string,
) {
  const ids = descendants(
    rows.map((row) => ({ id: row.id, parent: row.replyParentId })),
    anchor,
  );
  return rows.filter((row) => ids.has(row.id));
}
