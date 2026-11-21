// Fast CSV reader with csv-reader 1.0.0's exact broken-row semantics.
//
// Design: the text is scanned once, left to right. An unquoted field (the
// common case) ends at the first comma or LF, both located with indexOf,
// and is extracted with a single slice; the positions of the next CR and
// next LF are cached across fields, since pos only moves forward, so each
// is located once per file rather than once per field. A cached CR just
// before the field's LF is the CRLF terminator; any other CR before the
// field's end is stray and takes a slower char-by-char scan. Quoted fields
// jump from quote to quote with indexOf; only segments that hold a CR
// (which must be normalised to LF) are rebuilt piece by piece. Error
// objects are allocated only when an error actually occurs.
const COMMA_END = 0;
const BREAK_END = 1;
const TEXT_END = 2;

export function run(input) {
  const s = String(input.text);
  const header = input.header === true;
  const n = s.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0;
  let line = 1;
  if (s.charCodeAt(0) === 0xfeff) pos = 1;

  let recordLine = 1;
  let recordRow = null;

  let fEnded = TEXT_END;
  let fAdded = 0;

  // Cached positions of the next CR / LF at or after the point they were
  // computed for. pos only moves forward, so a cached position >= pos is
  // still the first such character at or after pos; a smaller one is stale
  // and is recomputed. -1 means none in the rest of the text.
  let nextCR = -2;
  let nextLF = -2;
  function crFrom(p) {
    if (nextCR < p) nextCR = s.indexOf('\r', p);
    return nextCR;
  }
  function lfFrom(p) {
    if (nextLF < p) nextLF = s.indexOf('\n', p);
    return nextLF;
  }

  function parseUnquoted(prefix) {
    let start = pos;
    let parts = null;
    let kept = 0;
    while (pos < n) {
      const c = s.charCodeAt(pos);
      if (c === 44) {
        const piece = s.slice(start, pos);
        pos += 1;
        fEnded = COMMA_END;
        fAdded = kept + piece.length;
        if (parts !== null) { parts.push(piece); return parts.join(''); }
        return prefix === '' ? piece : prefix + piece;
      }
      if (c === 10) {
        const piece = s.slice(start, pos);
        pos += 1;
        line += 1;
        fEnded = BREAK_END;
        fAdded = kept + piece.length;
        if (parts !== null) { parts.push(piece); return parts.join(''); }
        return prefix === '' ? piece : prefix + piece;
      }
      if (c === 13) {
        if (s.charCodeAt(pos + 1) === 10) {
          const piece = s.slice(start, pos);
          pos += 2;
          line += 1;
          fEnded = BREAK_END;
          fAdded = kept + piece.length;
          if (parts !== null) { parts.push(piece); return parts.join(''); }
          return prefix === '' ? piece : prefix + piece;
        }
        errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
        if (parts === null) parts = [prefix];
        const piece = s.slice(start, pos);
        parts.push(piece);
        kept += piece.length;
        pos += 1;
        start = pos;
        continue;
      }
      pos += 1;
    }
    const piece = s.slice(start, pos);
    fEnded = TEXT_END;
    fAdded = kept + piece.length;
    if (parts !== null) { parts.push(piece); return parts.join(''); }
    return prefix === '' ? piece : prefix + piece;
  }

  // Slow unquoted scan used when the fast path spots a stray CR in the
  // field: identical results to parseUnquoted('') but kept separate so the
  // fast path stays branch-light. Returns the field value, sets fEnded.
  function scanUnquotedSlow() {
    let start = pos;
    let parts = null;
    for (;;) {
      if (pos >= n) {
        const piece = s.slice(start, pos);
        fEnded = TEXT_END;
        return parts === null ? piece : (parts.push(piece), parts.join(''));
      }
      const c = s.charCodeAt(pos);
      if (c === 44) {
        const piece = s.slice(start, pos);
        pos += 1;
        fEnded = COMMA_END;
        return parts === null ? piece : (parts.push(piece), parts.join(''));
      }
      if (c === 10) {
        const piece = s.slice(start, pos);
        pos += 1;
        line += 1;
        fEnded = BREAK_END;
        return parts === null ? piece : (parts.push(piece), parts.join(''));
      }
      if (c === 13) {
        if (s.charCodeAt(pos + 1) === 10) {
          const piece = s.slice(start, pos);
          pos += 2;
          line += 1;
          fEnded = BREAK_END;
          return parts === null ? piece : (parts.push(piece), parts.join(''));
        }
        errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
        if (parts === null) parts = [];
        parts.push(s.slice(start, pos));
        pos += 1;
        start = pos;
        continue;
      }
      pos += 1;
    }
  }

  function parseQuoted() {
    const open = pos;
    const openLine = line;
    pos += 1;
    let segStart = pos;
    let parts = null;
    let value = '';
    for (;;) {
      const q = s.indexOf('"', pos);
      if (q === -1) {
        pos = open + 1;
        line = openLine;
        nextCR = -2; // pos rewinds: the cached positions are stale
        nextLF = -2;
        errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
        return parseUnquoted('"');
      }
      let seg;
      const cr = crFrom(segStart);
      if (cr !== -1 && cr < q) {
        const pieces = [];
        let st = segStart;
        let i = segStart;
        while (i < q) {
          const c = s.charCodeAt(i);
          if (c === 13) {
            pieces.push(s.slice(st, i));
            pieces.push('\n');
            line += 1;
            i += s.charCodeAt(i + 1) === 10 ? 2 : 1;
            st = i;
          } else {
            if (c === 10) line += 1;
            i += 1;
          }
        }
        pieces.push(s.slice(st, q));
        seg = pieces.join('');
      } else {
        let p = lfFrom(segStart);
        if (p !== -1 && p < q) {
          let count = 0;
          while (p !== -1 && p < q) {
            count += 1;
            p = s.indexOf('\n', p + 1);
          }
          line += count;
          nextLF = p; // first LF at or after q, or -1
        }
        seg = s.slice(segStart, q);
      }
      if (s.charCodeAt(q + 1) === 34) {
        if (parts === null) parts = [];
        parts.push(seg);
        parts.push('"');
        pos = q + 2;
        segStart = pos;
        continue;
      }
      if (parts === null) {
        value = seg;
      } else {
        parts.push(seg);
        value = parts.join('');
      }
      pos = q + 1;
      break;
    }
    if (pos >= n) { fEnded = TEXT_END; return value; }
    const c = s.charCodeAt(pos);
    if (c === 44) { pos += 1; fEnded = COMMA_END; return value; }
    if (c === 10) { pos += 1; line += 1; fEnded = BREAK_END; return value; }
    if (c === 13 && s.charCodeAt(pos + 1) === 10) { pos += 2; line += 1; fEnded = BREAK_END; return value; }
    const joined = parseUnquoted(value);
    if (fAdded > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
    return joined;
  }

  for (;;) {
    while (pos < n) {
      const c = s.charCodeAt(pos);
      if (c === 10) { pos += 1; line += 1; }
      else if (c === 13 && s.charCodeAt(pos + 1) === 10) { pos += 2; line += 1; }
      else break;
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let lastQuoted = false;
    for (;;) {
      if (pos < n && s.charCodeAt(pos) === 34) {
        lastQuoted = true;
        fields.push(parseQuoted());
      } else {
        lastQuoted = false;
        // Fast unquoted field: the field ends at the first comma or LF.
        // The first CR decides the exceptions: CR immediately before that
        // LF is the CRLF terminator; any other CR before the end is stray
        // and takes the slow scan.
        const start = pos;
        const comma = s.indexOf(',', start);
        if (nextLF < start) nextLF = s.indexOf('\n', start);
        if (nextCR < start) nextCR = s.indexOf('\r', start);
        const lf = nextLF;
        const cr = nextCR;
        const endC = comma === -1 ? Infinity : comma;
        const endL = lf === -1 ? Infinity : lf;
        if (cr !== -1 && cr < endC && cr < endL) {
          if (cr + 1 === endL) {
            // CRLF terminator.
            fields.push(s.slice(start, cr));
            pos = cr + 2;
            line += 1;
            fEnded = BREAK_END;
          } else {
            fields.push(scanUnquotedSlow());
          }
        } else if (endC === Infinity && endL === Infinity) {
          fields.push(s.slice(start, n));
          pos = n;
          fEnded = TEXT_END;
        } else if (endC < endL) {
          fields.push(s.slice(start, comma));
          pos = comma + 1;
          fEnded = COMMA_END;
        } else {
          fields.push(s.slice(start, lf));
          pos = lf + 1;
          line += 1;
          fEnded = BREAK_END;
        }
      }
      if (fEnded !== COMMA_END) break;
    }

    if (fields.length === 1 && fields[0] === '' && !lastQuoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) { columns = fields; continue; }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }

  return { columns: header ? (columns ?? []) : null, rows, errors };
}
