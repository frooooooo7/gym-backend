const POLISH_CHAR_MAP: Record<string, string> = {
  ą: "a",
  ć: "c",
  ę: "e",
  ł: "l",
  ń: "n",
  ó: "o",
  ś: "s",
  ź: "z",
  ż: "z",
};

export const handleBaseFromName = (firstName: string, lastName: string): string => {
  const raw = `${firstName}.${lastName}`.toLowerCase();
  let normalized = raw;
  for (const [from, to] of Object.entries(POLISH_CHAR_MAP)) {
    normalized = normalized.replaceAll(from, to);
  }
  return normalized.replace(/[^a-z0-9._]/g, "");
};

export const uniqueHandleFromId = (base: string, userId: string): string => {
  const suffix = userId.replace(/-/g, "").slice(0, 6);
  const maxBaseLength = Math.max(1, 50 - suffix.length - 1);
  const trimmedBase = base.slice(0, maxBaseLength).replace(/[._]+$/, "") || "user";
  return `${trimmedBase}_${suffix}`;
};

export const normalizeHandle = (raw: string): string => {
  let normalized = raw.trim().toLowerCase();
  for (const [from, to] of Object.entries(POLISH_CHAR_MAP)) {
    normalized = normalized.replaceAll(from, to);
  }
  return normalized.replace(/[^a-z0-9._]/g, "");
};

export const isValidHandle = (handle: string): boolean =>
  handle.length >= 3 && handle.length <= 50 && /^[a-z0-9._]+$/.test(handle);
