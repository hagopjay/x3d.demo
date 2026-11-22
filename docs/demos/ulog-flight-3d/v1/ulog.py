"""Defensive standard-library reader for PX4 ULog (.ulg) files.

Format: https://docs.px4.io/main/en/dev_log/ulog_file_format.html
  16-byte header: magic b"ULog" 01 12 35, version u8, start timestamp u64 (microseconds)
  then messages: u16 msg_size, u8 msg_type, msg_size bytes of payload.
  Definitions: B flag bits, F format, I info, M multi-info, P param, Q default param.
  Data:        A add-logged (subscription), R remove, D data, L log string, C tagged log string,
               S sync, O dropout.

Nothing here executes or evaluates file content. Every length is bounds-checked; a corrupt
message is counted and skipped (with a resync on the next sync magic, as the spec suggests).

  python3 -I ulog.py file.ulg    -> prints an inventory
"""
import struct, sys

MAGIC = b"ULog\x01\x12\x35"
SYNC = bytes([0x2F, 0x73, 0x13, 0x20, 0x25, 0x0C, 0xBB, 0x12])
BASIC = {"int8_t": "b", "uint8_t": "B", "int16_t": "h", "uint16_t": "H", "int32_t": "i", "uint32_t": "I",
         "int64_t": "q", "uint64_t": "Q", "float": "f", "double": "d", "bool": "?", "char": "c"}
LEVELS = {ord("0"): "EMERG", ord("1"): "ALERT", ord("2"): "CRIT", ord("3"): "ERR", ord("4"): "WARNING",
          ord("5"): "NOTICE", ord("6"): "INFO", ord("7"): "DEBUG"}
MAX_FIELDS, MAX_DEPTH = 4096, 8


class ULogError(Exception):
    pass


def _type(t):
    """'float[4]' -> ('float', 4); 'uint8_t' -> ('uint8_t', None)."""
    if t.endswith("]") and "[" in t:
        base, n = t[:-1].split("[", 1)
        if not n.isdigit() or not 0 <= int(n) <= 65535:
            raise ULogError("bad array length in %r" % t)
        return base, int(n)
    return t, None


def _value(raw, kind):
    base, n = _type(kind)
    if base == "char":
        return raw.split(b"\0", 1)[0].decode("utf-8", "replace")
    code = BASIC.get(base)
    if not code:
        return raw.hex()
    size = struct.calcsize("<" + code)
    if n is None:
        return struct.unpack("<" + code, raw[:size])[0] if len(raw) >= size else None
    return list(struct.unpack("<%d%s" % (n, code), raw[:n * size])) if len(raw) >= n * size else None


class ULog:
    def __init__(self, path, topics=None):
        """topics: optional set of topic names to decode (others are counted, not decoded)."""
        self.path, self.want = path, topics
        self.formats = {}          # name -> [(type, field)]
        self.info, self.params, self.default_params = {}, {}, []
        self.multi_info = {}
        self.subs = {}             # msg_id -> (name, multi_id)
        self.data = {}             # (name, multi_id) -> list of dicts
        self.counts = {}           # (name, multi_id) -> message count
        self.logs = []             # (timestamp_us, level, text, tag or None)
        self.dropouts = []         # (timestamp of last data seen, duration ms)
        self.flags = None
        self.bad = 0
        self._last_ts = 0
        self.msg_types = {}
        self._layout = {}
        with open(path, "rb") as f:
            self.buf = f.read()
        self._parse()
        del self.buf

    # ---- formats -------------------------------------------------------------------------
    def _layout_of(self, name, depth=0):
        """Flattened list of (offset, struct code, count, field path, is_char) for a format."""
        if name in self._layout:
            return self._layout[name]
        if depth > MAX_DEPTH or name not in self.formats:
            raise ULogError("unknown or too deeply nested format %r" % name)
        out, off = [], 0
        for kind, field in self.formats[name]:
            base, n = _type(kind)
            reps = n or 1
            if base in BASIC:
                size = struct.calcsize("<" + BASIC[base])
                if not field.startswith("_padding"):
                    out.append((off, BASIC[base], n, field, base == "char"))
                off += size * reps
            else:
                sub, subsize = self._layout_of(base, depth + 1)
                for r in range(reps):
                    pre = field + ("[%d]" % r if n else "") + "."
                    for (o, c, k, fp, ch) in sub:
                        out.append((off + o, c, k, pre + fp, ch))
                    off += subsize
            if len(out) > MAX_FIELDS:
                raise ULogError("format %r too large" % name)
        self._layout[name] = (out, off)
        return out, off

    def _decode(self, name, raw):
        layout, _size = self._layout_of(name)
        rec = {}
        for off, code, n, field, is_char in layout:
            if is_char and n:
                if off + n <= len(raw):
                    rec[field] = raw[off:off + n].split(b"\0", 1)[0].decode("utf-8", "replace")
                continue
            fmt = "<%d%s" % (n, code) if n else "<" + code
            end = off + struct.calcsize(fmt)
            if end > len(raw):          # trailing padding may be truncated by the logger
                continue
            v = struct.unpack_from(fmt, raw, off)
            rec[field] = list(v) if n else v[0]
        return rec

    # ---- stream --------------------------------------------------------------------------
    def _parse(self):
        b = self.buf
        if len(b) < 16 or b[:7] != MAGIC:
            raise ULogError("not a ULog file (magic %r)" % b[:7])
        self.version = b[7]
        self.start_us = struct.unpack_from("<Q", b, 8)[0]
        pos, n = 16, len(b)
        while pos + 3 <= n:
            size, mtype = struct.unpack_from("<HB", b, pos)
            body_start, body_end = pos + 3, pos + 3 + size
            if body_end > n:
                self.bad += 1            # truncated last message (common when power is cut)
                break
            p = b[body_start:body_end]
            t = chr(mtype)
            self.msg_types[t] = self.msg_types.get(t, 0) + 1
            try:
                self._handle(t, p)
            except (ULogError, struct.error, UnicodeDecodeError, ValueError, IndexError) as e:
                self.bad += 1
                nxt = b.find(SYNC, body_start)
                if nxt < 0:
                    break
                pos = nxt + len(SYNC)
                continue
            pos = body_end

    def _handle(self, t, p):
        if t == "B":
            if len(p) < 40:
                raise ULogError("short flag bits")
            self.flags = {"compat": list(p[0:8]), "incompat": list(p[8:16]),
                          "appended_offsets": list(struct.unpack_from("<3Q", p, 16))}
        elif t == "F":
            s = p.decode("ascii")
            name, _, rest = s.partition(":")
            fields = []
            for part in rest.split(";"):
                if part.strip():
                    kind, _, field = part.strip().partition(" ")
                    fields.append((kind, field))
            self.formats[name] = fields
        elif t in "IP":
            k = p[0]
            key = p[1:1 + k].decode("ascii")
            kind, _, name = key.partition(" ")
            val = _value(p[1 + k:], kind)
            (self.info if t == "I" else self.params)[name] = val
        elif t == "Q":
            k = p[1]
            key = p[2:2 + k].decode("ascii")
            kind, _, name = key.partition(" ")
            self.default_params.append((name, p[0], _value(p[2 + k:], kind)))
        elif t == "M":
            cont, k = p[0], p[1]
            key = p[2:2 + k].decode("ascii")
            kind, _, name = key.partition(" ")
            val = _value(p[2 + k:], kind)
            lst = self.multi_info.setdefault(name, [])
            if cont and lst:
                lst[-1] = lst[-1] + val if isinstance(val, str) else val
            else:
                lst.append(val)
        elif t == "A":
            multi, mid = p[0], struct.unpack_from("<H", p, 1)[0]
            name = p[3:].decode("ascii")
            if name not in self.formats:
                raise ULogError("subscription to unknown format %r" % name)
            self.subs[mid] = (name, multi)
        elif t == "R":
            pass
        elif t == "D":
            mid = struct.unpack_from("<H", p, 0)[0]
            sub = self.subs.get(mid)
            if sub is None:
                raise ULogError("data for unknown msg_id %d" % mid)
            self.counts[sub] = self.counts.get(sub, 0) + 1
            if len(p) >= 10:
                self._last_ts = struct.unpack_from("<Q", p, 2)[0]   # every topic starts with uint64 timestamp
            if self.want is None or sub[0] in self.want:
                self.data.setdefault(sub, []).append(self._decode(sub[0], p[2:]))
        elif t == "L":
            lvl, ts = p[0], struct.unpack_from("<Q", p, 1)[0]
            self.logs.append((ts, LEVELS.get(lvl, str(lvl)), p[9:].decode("utf-8", "replace"), None))
        elif t == "C":
            lvl, tag, ts = p[0], struct.unpack_from("<H", p, 1)[0], struct.unpack_from("<Q", p, 3)[0]
            self.logs.append((ts, LEVELS.get(lvl, str(lvl)), p[11:].decode("utf-8", "replace"), tag))
        elif t == "O":
            self.dropouts.append((self._last_ts, struct.unpack_from("<H", p, 0)[0]))
        # 'S' sync and unknown types are skipped (the spec says readers must ignore unknown types)

    def topic(self, name, multi=0):
        return self.data.get((name, multi), [])


if __name__ == "__main__":
    u = ULog(sys.argv[1])
    print("version", u.version, "start_us", u.start_us, "bad", u.bad, "flags", u.flags)
    print("msg types", u.msg_types)
    print("info", {k: v for k, v in u.info.items()})
    print("dropouts", [((t - u.start_us) / 1e6, d) for t, d in u.dropouts])
    for (name, m), c in sorted(u.counts.items()):
        rows = u.data.get((name, m), [])
        span = (rows[-1].get("timestamp", 0) - rows[0].get("timestamp", 0)) / 1e6 if rows else 0
        print("%-34s %d %6d  %.1f s" % (name, m, c, span))
    for ts, lvl, txt, tag in u.logs:
        print("LOG %.3f %s %s" % ((ts - u.start_us) / 1e6, lvl, txt))
