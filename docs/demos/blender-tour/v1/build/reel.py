"""The 45-second sizzle reel, cut in Blender's own Video Sequencer.

    Blender -b --factory-startup --python reel.py

Title card 2.5 s, eight 5-second clips with lower-third captions and 0.5 s crossfades, end card 2.5 s, and an original
procedural soundtrack (synthesized here: a chord a clip, a soft swell, a low pulse) so nothing third-party is in it.
"""
import json
import math
import struct
import wave
from pathlib import Path

import bpy

HERE = Path(__file__).resolve().parent
WILD = HERE / "wild"
FPS, W, H = 30, 1920, 1080
CLIPS = [  # (folder, file, title, line)
    ("lorenz", "lorenz.mp4", "Chaos", "Lorenz attractor · 2,000 particles in a Simulation Zone"),
    ("julia", "julia.mp4", "Fractals", "Julia-set terrain · z ← z² + c in a Repeat Zone"),
    ("life", "life.mp4", "Emergence", "Conway's Game of Life on a torus · 4,096 cells"),
    ("phyllotaxis", "phyllotaxis.mp4", "Nature's maths", "Phyllotaxis · the golden angle, 137.5°"),
    ("waves", "waves.mp4", "Physics", "Ripple tank · two sources interfering"),
    ("city", "city.mp4", "Modelling", "Procedural city · grid → lots → towers"),
    ("turrets", "turrets.mp4", "Gameplay", "Turret defense · constraints as game logic"),
    ("x3d-orrery", "x3d-orrery.mp4", "X3D, live", "An X3D world played by the node editor · click → camera flight"),
]
TITLE, CLIP, FADE, END = int(2.5 * FPS), 5 * FPS, int(0.5 * FPS), int(2.5 * FPS)


def soundtrack(path, seconds, cuts):
    """A pad: each clip gets its own chord (A minor, F, C, G, D minor, A minor, E, A), sine partials with a slow
    attack, plus a soft low pulse on the beat (100 bpm) and a rising swell into each cut."""
    rate = 44100
    chords = [(57, 60, 64), (53, 57, 60), (48, 52, 55), (55, 59, 62), (50, 53, 57), (57, 60, 64), (52, 56, 59), (57, 61, 64)]
    hz = lambda m: 440.0 * 2 ** ((m - 69) / 12)
    n = int(seconds * rate)
    out = bytearray()
    for i in range(n):
        t = i / rate
        seg = 0 if t < cuts[0] else min(len(chords) - 1, sum(1 for c in cuts[1:] if t >= c))
        local = t - (cuts[seg] if seg < len(cuts) else 0)
        env = min(1.0, max(local, 0) / 0.6) * (0.55 + 0.45 * math.sin(2 * math.pi * 0.2 * t) ** 2)
        s = 0.0
        for k, m in enumerate(chords[seg]):
            f = hz(m)
            s += math.sin(2 * math.pi * f * t) * 0.22 + math.sin(2 * math.pi * f * 2 * t + k) * 0.05
        beat = (t * 100 / 60) % 1.0
        s += math.sin(2 * math.pi * hz(chords[seg][0] - 24) * t) * math.exp(-beat * 6) * 0.45
        nxt = min((c for c in cuts if c > t), default=None)
        if nxt is not None and nxt - t < 0.8:
            s += math.sin(2 * math.pi * (300 + 900 * (0.8 - (nxt - t))) * t) * 0.03 * (0.8 - (nxt - t))
        fade = min(1.0, t / 1.5, (seconds - t) / 2.0)
        v = max(-1.0, min(1.0, s * env * fade * 0.6))
        out += struct.pack("<hh", int(v * 30000), int(v * 30000))
    with wave.open(str(path), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(bytes(out))


def text(sed, name, body, channel, start, length, size, y, colour=(1, 1, 1, 1), box=False):
    s = sed.strips.new_effect(name, type="TEXT", channel=channel, frame_start=start, length=length)
    s.text, s.font_size, s.color = body, size, colour
    s.location = (0.5, y)
    s.anchor_x = "CENTER" if hasattr(s, "anchor_x") else s.anchor_x
    s.use_shadow = True
    if box:
        s.use_box, s.box_color = True, (0, 0, 0, 0.55)
    s.blend_type = "ALPHA_OVER"
    return s


def steps(live):
    """The edit as a generator: yield seconds to pause (only in a live window), so each strip lands on screen."""
    import sys as _sys
    scene = bpy.context.scene
    scene.render.fps, scene.render.resolution_x, scene.render.resolution_y = FPS, W, H
    scene.frame_start, scene.frame_end = 1, TITLE + len(CLIPS) * CLIP + END
    sed = scene.sequence_editor_create()
    facts = {"clips": []}
    if live:
        win = bpy.context.window_manager.windows[0]
        win.event_simulate(type="ESC", value="PRESS")     # the splash screen
        win.event_simulate(type="ESC", value="RELEASE")
        show_sequencer(scene)
        yield 1.0
    start = TITLE + 1
    colour = sed.strips.new_effect("Black", type="COLOR", channel=1, frame_start=1, length=TITLE + FADE)
    colour.color = (0.0, 0.0, 0.0)
    text(sed, "Title", "BLENDER  ×  X3D", 5, 1, TITLE, 120, 0.56, (1.0, 0.85, 0.45, 1))
    text(sed, "Subtitle", "simulations · maths · games · modelling · a live X3D world", 6, 1, TITLE, 44, 0.42)
    scene.frame_current = 40
    if live:
        fit()
    yield 1.2
    if live:
        snap("1-title")
    prev = colour
    cuts = []
    for k, (folder, name, title, line) in enumerate(CLIPS):
        path = WILD / folder / name
        if not path.exists():
            facts["clips"].append({"clip": name, "missing": True})
            continue
        ch = 2 + (k % 2)
        frame = start - FADE
        mv = sed.strips.new_movie(title, str(path), channel=ch, frame_start=frame)
        mv.frame_final_duration = CLIP + FADE
        scene.frame_current = start + CLIP // 2
        if live:
            for s in sed.strips_all:
                s.select = False
            fit()
        yield 0.5
        sed.strips.new_effect(f"x{k}", type="CROSS", channel=4, frame_start=frame, length=FADE, input1=prev, input2=mv)
        text(sed, f"T{k}", title.upper(), 7, start, CLIP - FADE, 64, 0.17, (1.0, 0.85, 0.45, 1))
        text(sed, f"L{k}", line, 8, start, CLIP - FADE, 36, 0.10, box=True)
        facts["clips"].append({"clip": name, "start_s": round((frame - 1) / FPS, 2)})
        cuts.append((frame - 1) / FPS)
        prev = mv
        start += CLIP
        yield 0.6
        if live and k in (0, 4):
            snap(f"2-clip-{k}")
    end_bg = sed.strips.new_effect("EndBlack", type="COLOR", channel=2 + (len(CLIPS) % 2), frame_start=start - FADE, length=END + FADE)
    end_bg.color = (0.0, 0.0, 0.0)
    sed.strips.new_effect("xend", type="CROSS", channel=4, frame_start=start - FADE, length=FADE, input1=prev, input2=end_bg)
    text(sed, "End", "Made in Blender 5.3 with the X3D Blender I/O add-on", 5, start, END, 52, 0.55, (1.0, 0.85, 0.45, 1))
    text(sed, "End2", "every frame procedural · every node judged against X_ITE", 6, start, END, 36, 0.43)
    scene.frame_end = start + END - 1
    seconds = scene.frame_end / FPS
    wav = WILD / "soundtrack.wav"
    if not wav.exists():
        soundtrack(wav, seconds, [0.0] + cuts)
    sed.strips.new_sound("Soundtrack", str(wav), channel=9, frame_start=1)
    if hasattr(scene.render.image_settings, "media_type"):
        scene.render.image_settings.media_type = "VIDEO"      # 5.x: FFMPEG is only offered for video output
    scene.render.image_settings.file_format = "FFMPEG"
    scene.render.ffmpeg.format, scene.render.ffmpeg.codec = "MPEG4", "H264"
    scene.render.ffmpeg.constant_rate_factor = "HIGH"
    scene.render.ffmpeg.audio_codec, scene.render.ffmpeg.audio_bitrate = "AAC", 192
    scene.render.filepath = str(WILD / "sizzle-reel-45s.mp4")
    facts.update(frames=scene.frame_end, seconds=round(seconds, 2), out=scene.render.filepath, cuts_s=[round(c, 2) for c in cuts])
    (WILD / "reel.json").write_text(json.dumps(facts, indent=1))
    bpy.ops.wm.save_as_mainfile(filepath=str(WILD / "sizzle-reel.blend"))
    if live and "--check" in _sys.argv:
        return
    if live:
        scene.frame_current = 1
        yield 0.8
        win = bpy.context.window_manager.windows[0]
        with bpy.context.temp_override(window=win):
            bpy.ops.screen.animation_play()          # watch the cut once in the preview
        yield seconds + 1.0
        with bpy.context.temp_override(window=win):
            bpy.ops.screen.animation_cancel(restore_frame=True)
        yield 0.5
        with bpy.context.temp_override(window=win):
            bpy.ops.render.render("INVOKE_DEFAULT", animation=True)   # the render window fills frame by frame
        yield 2.0
        while bpy.app.is_job_running("RENDER"):     # render_complete fires per frame in an animation: ask the job
            yield 1.0
        yield 2.0
    else:
        bpy.ops.render.render(animation=True)
    print("REEL", facts)


DONE = {"render": False}


def fit():
    """Fit the preview to its frame and the timeline to its strips (a converted area starts with a useless zoom)."""
    win = bpy.context.window_manager.windows[0]
    for a in win.screen.areas:
        if a.type != "SEQUENCE_EDITOR":
            continue
        region = next(r for r in a.regions if r.type == "WINDOW")
        with bpy.context.temp_override(window=win, area=a, region=region):
            try:
                if a.spaces.active.view_type == "PREVIEW":
                    bpy.ops.sequencer.view_all_preview()
                else:
                    bpy.ops.sequencer.view_all()
            except Exception as error:
                print("fit", error)
        a.tag_redraw()


def snap(name):
    win = bpy.context.window_manager.windows[0]
    for s in bpy.context.scene.sequence_editor.strips_all:
        s.select = False                            # no selection outlines over the picture
    (WILD / "reel-shots").mkdir(exist_ok=True)
    with bpy.context.temp_override(window=win):
        bpy.ops.screen.screenshot(filepath=str(WILD / "reel-shots" / f"{name}.png"))


def _render_done(*_):
    DONE["render"] = True


def show_sequencer(scene):
    """Turn the Layout workspace into an editing suite: preview on top, the strip timeline below."""
    win = bpy.context.window_manager.windows[0]
    win.workspace.sequencer_scene = scene          # 5.x: the sequencer shows its workspace's sequencer scene, not the window's
    big = max((a for a in win.screen.areas), key=lambda a: a.width * a.height)
    with bpy.context.temp_override(window=win, area=big, region=next(r for r in big.regions if r.type == "WINDOW")):
        bpy.ops.screen.area_split(direction="HORIZONTAL", factor=0.36)     # the lower 36 % becomes the strip timeline
    areas = sorted((a for a in win.screen.areas if a.type == "VIEW_3D"), key=lambda a: a.y)
    lower, upper = areas[0], areas[-1]
    upper.type = "SEQUENCE_EDITOR"
    upper.spaces.active.view_type = "PREVIEW"
    lower.type = "SEQUENCE_EDITOR"
    lower.spaces.active.view_type = "SEQUENCER"
    for a in win.screen.areas:
        if a.type == "SEQUENCE_EDITOR" and a.spaces.active.view_type == "SEQUENCER":
            with bpy.context.temp_override(window=win, area=a, region=next(r for r in a.regions if r.type == "WINDOW")):
                try:
                    bpy.ops.sequencer.view_all()
                except Exception:
                    pass


if __name__ == "__main__":
    import sys
    if "--synth" in sys.argv:                       # make the soundtrack ahead of time (pure Python: about a minute)
        cuts = [(TITLE + 1 - FADE + k * CLIP - 1) / FPS for k in range(len(CLIPS))]
        soundtrack(WILD / "soundtrack.wav", (TITLE + len(CLIPS) * CLIP + END) / FPS, [0.0] + cuts)
        print("SYNTH done")
    elif bpy.app.background:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        for _ in steps(False):
            pass
    else:
        bpy.app.handlers.render_complete.append(_render_done)
        bpy.app.handlers.render_cancel.append(_render_done)
        gen = steps(True)

        def tick():
            try:
                return next(gen)
            except StopIteration:
                bpy.ops.wm.quit_blender()
                return None
        bpy.app.timers.register(tick, first_interval=1.5)
