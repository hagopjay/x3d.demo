"""Render short excerpts of public-domain scores from the music21 corpus with a small additive synthesizer.
Usage: python synth.py OUT_DIR   (writes <id>.wav and a manifest.json; mp3 encoding is done by ffmpeg afterwards)"""
import sys, json, math, os, numpy as np
from music21 import corpus, tempo, note, chord
SR = 22050
PIECES = [  # id, corpus path, title, composer, year, timbre, default qpm, seconds
 ("handel-lascia", "handel/rinaldo/Lascia_chio_pianga.mxl", "Lascia ch'io pianga (Rinaldo)", "George Frideric Handel", 1711, "voice", 60, 40),
 ("bach-bwv846", "bach/bwv846.mxl", "Prelude in C major, BWV 846 (Well-Tempered Clavier I)", "Johann Sebastian Bach", 1722, "keys", 72, 40),
 ("haydn-op1no1", "haydn/opus1no1/movement1.mxl", "String Quartet Op. 1 No. 1, i. Presto", "Joseph Haydn", 1762, "strings", 140, 35),
 ("mozart-k458", "mozart/k458/movement1.mxl", "String Quartet K. 458 'The Hunt', i", "Wolfgang Amadeus Mozart", 1784, "strings", 132, 35),
 ("mozart-k545", "mozart/k545/movement1_exposition.mxl", "Piano Sonata K. 545, i (exposition)", "Wolfgang Amadeus Mozart", 1788, "keys", 120, 35),
 ("haydn-op74no1", "haydn/opus74no1/movement1.mxl", "String Quartet Op. 74 No. 1, i", "Joseph Haydn", 1793, "strings", 120, 35),
 ("beethoven-op18no1", "beethoven/opus18no1/movement1.mxl", "String Quartet Op. 18 No. 1, i", "Ludwig van Beethoven", 1800, "strings", 150, 35),
 ("beethoven-op59no1", "beethoven/opus59no1/movement1.mxl", "String Quartet Op. 59 No. 1 'Razumovsky', i", "Ludwig van Beethoven", 1806, "strings", 112, 35),
 ("beethoven-op132", "beethoven/opus132.mxl", "String Quartet Op. 132", "Ludwig van Beethoven", 1825, "strings", 72, 40),
 ("schubert-lindenbaum", "schubert/Lindenbaum.xml", "Der Lindenbaum (Winterreise)", "Franz Schubert", 1827, "voice", 76, 40),
 ("chopin-mazurka", "chopin/mazurka06-2.krn", "Mazurka Op. 6 No. 2", "Frederic Chopin", 1830, "keys", 120, 35),
 ("verdi-donna", "verdi/laDonnaEMobile.mxl", "La donna e mobile (Rigoletto)", "Giuseppe Verdi", 1851, "voice", 138, 30),
]


def tone(f, dur, kind, vel, part_i):
    n = int((dur + (1.2 if kind == "keys" else 0.25)) * SR)
    t = np.arange(n) / SR
    if kind == "keys" or (kind == "voice" and part_i > 0):
        env = np.exp(-t * (2.2 + f / 900)) * np.minimum(1, t / 0.004)
        rel = np.clip((dur + 0.08 - t) / 0.08, 0, 1) ** 0.5 if kind != "keys" else 1
        env = env * (rel if kind != "keys" else np.clip((dur + 0.9 - t) / 0.9, 0, 1))
        y = sum(a * np.sin(2 * math.pi * f * k * (1 + 0.0004 * k * k) * t) for k, a in ((1, 1), (2, .45), (3, .22), (4, .12), (5, .06)))
    elif kind == "strings":
        vib = 1 + 0.004 * np.sin(2 * math.pi * 5.4 * t) * np.minimum(1, t / 0.25)
        env = np.minimum(1, t / 0.05) * np.clip((dur + 0.12 - t) / 0.12, 0, 1)
        ph = 2 * math.pi * f * np.cumsum(vib) / SR
        y = sum((1 / k) * np.sin(k * ph) for k in range(1, 9)) * 0.55
    else:  # sung line: soft vowel
        vib = 1 + 0.006 * np.sin(2 * math.pi * 5.2 * t) * np.minimum(1, t / 0.35)
        env = np.minimum(1, t / 0.07) * np.clip((dur + 0.15 - t) / 0.15, 0, 1)
        ph = 2 * math.pi * f * np.cumsum(vib) / SR
        y = np.sin(ph) + 0.35 * np.sin(2 * ph) + 0.12 * np.sin(3 * ph)
    return (y * env * vel).astype(np.float32)


def render(path, kind, qpm, secs):
    s = corpus.parse(path)
    if not s.recurse().getElementsByClass(tempo.MetronomeMark):
        s.insert(0, tempo.MetronomeMark(number=qpm))
    out = np.zeros(int((secs + 3) * SR), np.float32)
    notes = 0
    for pi, part in enumerate(s.parts if s.parts else [s]):
        smap = part.flatten().secondsMap
        for e in smap:
            el = e["element"]
            if not isinstance(el, (note.Note, chord.Chord)):
                continue
            st, du = e["offsetSeconds"], max(0.05, e["durationSeconds"])
            if st >= secs:
                continue
            for p in el.pitches:
                y = tone(p.frequency, du, kind, 0.22 if kind != "voice" or pi else 0.32, pi)
                i0 = int(st * SR); i1 = min(len(out), i0 + len(y))
                out[i0:i1] += y[: i1 - i0]; notes += 1
    # small hall: exponentially decaying noise impulse response
    rng = np.random.default_rng(7)
    ir = rng.standard_normal(int(1.6 * SR)).astype(np.float32) * np.exp(-np.arange(int(1.6 * SR)) / SR * 3.2)
    ir[0] = 6.0
    wet = np.fft.irfft(np.fft.rfft(out, len(out) + len(ir)) * np.fft.rfft(ir, len(out) + len(ir)))[: len(out)]
    y = 0.7 * out + 0.3 * wet / (np.max(np.abs(wet)) + 1e-9) * np.max(np.abs(out))
    fade = np.clip((secs + 2.5 - np.arange(len(y)) / SR) / 2.0, 0, 1); y *= fade
    y = y / (np.max(np.abs(y)) + 1e-9) * 0.89
    return y, notes


if __name__ == "__main__":
    od = sys.argv[1]; man = []
    import wave
    for pid, path, title, comp, year, kind, qpm, secs in PIECES:
        try:
            y, n = render(path, kind, qpm, secs)
        except Exception as ex:
            print("FAIL", pid, ex, flush=True); continue
        w = wave.open(os.path.join(od, pid + ".wav"), "wb"); w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((y * 32767).astype("<i2").tobytes()); w.close()
        man.append(dict(id=pid, corpus=path, title=title, composer=comp, year=year, timbre=kind, seconds=secs, notes=n))
        print("ok", pid, n, flush=True)
    json.dump(man, open(os.path.join(od, "manifest.json"), "w"), indent=1)
