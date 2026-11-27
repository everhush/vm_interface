/** Bounded JSON reader rejecting duplicate decoded keys at every depth. */
export function strictJson(source: string): unknown {
  let i = 0;
  const whitespace = () => {
    while (i < source.length && /[\x20\t\r\n]/.test(source[i])) i++;
  };
  const fail = () => {
    throw Error("Invalid or duplicate JSON member at " + i);
  };
  function string(): string {
    if (source[i++] !== '"') return fail();
    const start = i - 1;
    while (i < source.length) {
      const c = source[i++];
      if (c === "\\") {
        if (i >= source.length) return fail();
        i++;
      } else if (c === '"') return JSON.parse(source.slice(start, i)) as string;
    }
    return fail();
  }
  function value(depth: number): unknown {
    if (depth > 128) throw Error("JSON nesting exceeds bound");
    whitespace();
    if (source[i] === '"') return string();
    if (source[i] === "{") {
      i++;
      whitespace();
      const obj: Record<string, unknown> = Object.create(null),
        seen = new Set<string>();
      if (source[i] === "}") {
        i++;
        return obj;
      }
      for (;;) {
        whitespace();
        const key = string();
        if (seen.has(key)) return fail();
        seen.add(key);
        whitespace();
        if (source[i++] !== ":") return fail();
        obj[key] = value(depth + 1);
        whitespace();
        const c = source[i++];
        if (c === "}") return obj;
        if (c !== ",") return fail();
      }
    }
    if (source[i] === "[") {
      i++;
      whitespace();
      const out: unknown[] = [];
      if (source[i] === "]") {
        i++;
        return out;
      }
      for (;;) {
        out.push(value(depth + 1));
        whitespace();
        const c = source[i++];
        if (c === "]") return out;
        if (c !== ",") return fail();
      }
    }
    const m = /^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/.exec(
      source.slice(i),
    );
    if (!m) return fail();
    i += m[0].length;
    return JSON.parse(m[0]);
  }
  const result = value(0);
  whitespace();
  if (i !== source.length) return fail();
  return result;
}
