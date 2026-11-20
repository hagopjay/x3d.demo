#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Create a deterministic scientific overview, not a browser screenshot.

The first panel projects actual native X3D instrument geometry. Other panels
plot the application's analytical models. Node executes the same JS functions
used by the live interface. Requires matplotlib and numpy for this poster only.
The web application itself has no matplotlib/numpy dependency.
"""
from __future__ import annotations

import json
import math
from pathlib import Path
import subprocess
import xml.etree.ElementTree as ET

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Rectangle, Polygon
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "shots"
BG = "#08121c"
PANEL = "#101e2b"
GRID = "#263e4d"
INK = "#f0eddf"
MUTED = "#9db0bb"
GOLD = "#efc579"
CYAN = "#73dbe5"
VIOLET = "#b6a1f0"
CORAL = "#ed9a91"
FAINT = "#527d8a"


def numbers(raw):
    return np.fromstring(raw, sep=" ")


def read_models():
    code = r"""
import fs from 'node:fs';
import {geometry,modelSweep,crossSection,tangentPlane,similarityFit} from './instrument-math.mjs';
import {moved} from './sky-math.mjs';
const data=JSON.parse(fs.readFileSync('assets/belt-instrument.json','utf8'));
const year=-2559,vectors=data.stars.map(s=>moved(s.p,s.v,year));
const mean=[0,1,2].map(i=>vectors.reduce((sum,v)=>sum+v[i]/Math.hypot(...v),0));
const sky=tangentPlane(vectors,mean).points,ground=data.ground.map(p=>p.p);
const slope=51+52/60;
console.log(JSON.stringify({reference:geometry(230.363,slope),ghost:geometry(230.363,53.2),
section:crossSection(230.363,slope,.4),models:modelSweep(230.363,slope),
proper:similarityFit(sky,ground),reflected:similarityFit(sky,ground,{reflect:true}),
ground:data.ground,stars:data.stars.map(s=>s.name),
sweep:Array.from({length:301},(_,i)=>geometry(230.363,51.6+i*.5/300))}));
"""
    result = subprocess.run(["node", "--input-type=module", "-e", code], cwd=ROOT,
                            text=True, capture_output=True, check=True)
    return json.loads(result.stdout)


def tune(ax, title, subtitle):
    ax.set_facecolor(PANEL)
    for spine in ax.spines.values():
        spine.set_color(GRID)
    ax.tick_params(colors=MUTED, labelsize=8, length=3)
    ax.grid(color=GRID, alpha=.5, lw=.5)
    ax.set_axisbelow(True)
    ax.set_title(title, loc="left", color=INK, fontsize=13, fontweight="bold", pad=25)
    ax.text(0, 1.035, subtitle, transform=ax.transAxes, color=MUTED,
            fontsize=8, ha="left", va="bottom")
    ax.xaxis.label.set_color(MUTED)
    ax.yaxis.label.set_color(MUTED)


def harmonic_projection(ax):
    tree = ET.parse(ROOT / "assets" / "instruments.x3d").getroot()
    switch = next(n for n in tree.iter("Switch") if n.get("DEF") == "InstrumentHarmonics")
    art = switch.find("Group/Transform")
    shift = numbers(art.get("translation"))
    for shape in art.findall("Shape"):
        line_set = shape.find("IndexedLineSet")
        if line_set is not None:
            points = numbers(line_set.find("Coordinate").get("point")).reshape(-1, 3) + shift
            indices = [int(v) for v in line_set.get("coordIndex").split()]
            color = shape.find("Appearance/Material").get("emissiveColor")
            rgb = tuple(numbers(color))
            start = []
            for index in indices:
                if index == -1:
                    p = points[start]
                    ax.plot(p[:, 0], -p[:, 2], color=rgb, lw=.58, alpha=.68)
                    start = []
                else:
                    start.append(index)
        face_set = shape.find("IndexedFaceSet")
        if face_set is not None:
            # Both harmonic meshes are generated six-sided tubes; recover
            # their exact centreline by averaging each six-vertex ring.
            points = numbers(face_set.find("Coordinate").get("point")).reshape(-1, 6, 3).mean(axis=1)+shift
            color = INK if len(points) > 500 else CYAN
            ax.plot(points[:, 0], -points[:, 2], color=color, lw=1.0, alpha=.94)
    stage = json.loads((ROOT / "assets" / "stage-data.json").read_text())
    for name, p in stage["pyramids"].items():
        x, _, z = p["c"]
        a = p["a"]
        ax.add_patch(Rectangle((x-a, -z-a), 2*a, 2*a, fc=BG, ec=INK, lw=.8, alpha=.78))
        ax.plot(x, -z, "+", color=INK, ms=5, mew=.6)
        ax.text(x+8, -z+15, name, color=INK, fontsize=7.5)
    ax.set_xlim(-790, 295)
    ax.set_ylim(-860, 155)
    ax.set_aspect("equal", adjustable="box")
    ax.set_xlabel("East offset / m", fontsize=8)
    ax.set_ylabel("North offset / m", fontsize=8)
    ax.annotate("N", xy=(225, 15), xytext=(225, -115), color=CYAN, fontsize=9,
                ha="center", arrowprops={"arrowstyle": "->", "color": CYAN, "lw": .9})
    ax.text(.02, .02, "19 equal circles • φ growth each quarter-turn\nContemporary mathematical art; no archaeological claim.",
            transform=ax.transAxes, fontsize=7.3, color=MUTED, va="bottom",
            bbox={"facecolor": BG, "edgecolor": "none", "alpha": .85, "pad": 4})


def section_panel(ax, data):
    ref, ghost, section = data["reference"], data["ghost"], data["section"]
    a, h = ref["half"], ref["height"]
    triangle = [(-a, 0), (0, h), (a, 0)]
    ax.add_patch(Polygon(triangle, facecolor="#273b44", edgecolor=GOLD, lw=1.2))
    ax.plot([-a, 0, a], [0, ghost["height"], 0], color=VIOLET, lw=1.3, ls=(0, (5, 3)))
    for fraction in [.2, .4, .6, .8]:
        width = a*(1-fraction)
        ax.plot([-width, width], [h*fraction]*2, color=CYAN if fraction == .4 else FAINT,
                lw=2 if fraction == .4 else .65, alpha=1 if fraction == .4 else .5)
    sh, half = section["height"], section["side"]/2
    ax.fill([-a, -half, half, a], [0, sh, sh, 0], color=CYAN, alpha=.12)
    ax.plot([0, 0], [0, h], color=MUTED, lw=.55, ls=(0, (3, 4)))
    ax.annotate(f"{h:.3f} m", (0, h), xytext=(-91, 163), color=GOLD, fontsize=8,
                arrowprops={"arrowstyle": "-", "color": GOLD, "lw": .7})
    ax.annotate("counterfactual 53.2°", (0, ghost["height"]), xytext=(30, 168), color=VIOLET,
                fontsize=8, arrowprops={"arrowstyle": "-", "color": VIOLET, "lw": .7})
    ax.text(-147, sh+5, "f = 0.40", color=CYAN, fontsize=8)
    ax.text(.985, .04,
            f"SECTION HEIGHT   {sh:7.3f} m\nSQUARE SIDE      {section['side']:7.3f} m\nVOLUME BELOW       {100*section['fractionBelow']:5.1f}%",
            transform=ax.transAxes, color=INK, fontsize=8, family="DejaVu Sans Mono",
            ha="right", va="bottom", linespacing=1.8,
            bbox={"facecolor": BG, "edgecolor": GRID, "lw": .6, "pad": 8})
    ax.text(.02, .96, "Fixed reference casing + independent ghost model", transform=ax.transAxes,
            color=MUTED, fontsize=7.6, va="top")
    ax.set_xlim(-155, 155)
    ax.set_ylim(-3, 182)
    ax.set_xlabel("Face-section offset / m", fontsize=8)
    ax.set_ylabel("Height / m", fontsize=8)
    ax.set_xticks([-115, -60, 0, 60, 115])


def fit_panel(ax, data):
    ground = np.array([p["p"] for p in data["ground"]])
    ax.plot(ground[:, 0], ground[:, 1], color=FAINT, lw=.8, ls=(0, (4, 3)))
    for i, item in enumerate(data["ground"]):
        x, y = item["p"]
        a = item["base"]/2
        ax.add_patch(Rectangle((x-a, y-a), 2*a, 2*a, ec=FAINT, fc=BG, lw=.65, alpha=.65))
        ax.plot(x, y, "o", color=INK, ms=4)
        ax.text(x-12, y+28, item["name"], color=INK, fontsize=7.5, ha="right")
    for key, color, marker, label in [("proper", GOLD, "x", "Proper rotation"),
                                       ("reflected", VIOLET, "+", "Reflection allowed")]:
        points = np.array(data[key]["transformed"])
        ax.plot(points[:, 0], points[:, 1], color=color, lw=.85, alpha=.8)
        ax.scatter(points[:, 0], points[:, 1], marker=marker, s=32, linewidths=1, color=color, zorder=4, label=label)
        for a, b in zip(ground, points):
            ax.plot([a[0], b[0]], [a[1], b[1]], color=color, lw=.6, alpha=.7)
    ax.set_xlim(-740, 190)
    ax.set_ylim(-880, 160)
    ax.set_xlabel("East offset / m", fontsize=8)
    ax.set_ylabel("North offset / m", fontsize=8)
    ax.text(.97, .97, f"PROPER RMS    {data['proper']['rms']:.2f} m\nMIRRORED RMS  {data['reflected']['rms']:.2f} m",
            transform=ax.transAxes, color=INK, fontsize=8.5, family="DejaVu Sans Mono", ha="right", va="top", linespacing=1.8,
            bbox={"facecolor": BG, "edgecolor": GRID, "lw": .6, "pad": 7})
    inset = ax.inset_axes([.58, .075, .38, .41])
    inset.set_facecolor(BG)
    for s in inset.spines.values():
        s.set_color(FAINT)
    g = ground[1]
    inset.axhline(0, color=GRID, lw=.5)
    inset.axvline(0, color=GRID, lw=.5)
    inset.plot(0, 0, "o", color=INK, ms=4)
    for key, color, marker in [("proper", GOLD, "x"), ("reflected", VIOLET, "+")]:
        delta = np.array(data[key]["transformed"])[1]-g
        inset.plot([0, delta[0]], [0, delta[1]], color=color, lw=.8)
        inset.plot(*delta, marker=marker, color=color, ms=6)
    inset.set_xlim(-65, 65)
    inset.set_ylim(-65, 65)
    inset.set_xticks([-50, 0, 50])
    inset.set_yticks([-50, 0, 50])
    inset.tick_params(colors=MUTED, labelsize=6, length=2)
    inset.set_title("Khafre residual / m", color=MUTED, fontsize=7, pad=4)
    ax.text(.025, .97, "Fixed correspondence; 3 paired points\nRotation, scale and translation fitted.\nReflection is a separate extra choice.",
            transform=ax.transAxes, color=MUTED, fontsize=7.2, va="top", linespacing=1.6)
    leg = ax.legend(loc="upper left", bbox_to_anchor=(.015, .73), fontsize=7,
                    frameon=False, handlelength=1.7, labelcolor=MUTED)


def slope_panel(ax, data):
    sweep = data["sweep"]
    theta = np.array([m["slopeDeg"] for m in sweep])
    pi_error = np.array([m["pi"]/math.pi-1 for m in sweep])*100
    phi = (1+math.sqrt(5))/2
    phi_error = np.array([m["phi"]/phi-1 for m in sweep])*100
    ref = data["reference"]
    ax.axvspan(ref["slopeDeg"]-2/60, ref["slopeDeg"]+2/60, color=MUTED, alpha=.13,
               label="Historical ±2′ range (not 1σ)")
    ax.axhline(0, color=MUTED, lw=.65, ls=(0, (3, 4)))
    ax.plot(theta, pi_error, color=GOLD, lw=1.7, label="2b/h relative to π")
    ax.plot(theta, phi_error, color=CYAN, lw=1.7, label="slant/(b/2) relative to φ")
    ax.axvline(ref["slopeDeg"], color=INK, lw=.9, ls=(0, (3, 3)))
    for model in data["models"]:
        if model["key"] in ["pi", "phi"]:
            ax.plot(model["slopeDeg"], 0, "o", color=GOLD if model["key"] == "pi" else CYAN, ms=4)
    ax.set_xlim(51.6, 52.1)
    ax.set_ylim(-1.0, 1.05)
    ax.set_xlabel("Face slope / degrees", fontsize=8)
    ax.set_ylabel("Relative discrepancy / %", fontsize=8)
    ax.legend(loc="upper right", frameon=False, fontsize=7, labelcolor=MUTED)
    table = ["MODEL             SLOPE       Δh / m"]
    for model in data["models"]:
        label = {"measured": "Reference", "seked": "Seked 5½", "pi": "Exact π", "phi": "Exact φ"}[model["key"]]
        table.append(f"{label:<15} {model['slopeDeg']:8.5f}°  {model['heightDelta']:+.3f}")
    ax.text(.03, .035, "\n".join(table), transform=ax.transAxes, color=INK,
            family="DejaVu Sans Mono", fontsize=7.1, va="bottom", linespacing=1.6,
            bbox={"facecolor": BG, "edgecolor": GRID, "lw": .6, "pad": 7})
    ax.text(.98, .085, f"π-like: {ref['pi']:.6f}\nφ-like: {ref['phi']:.6f}",
            transform=ax.transAxes, color=INK, fontsize=8.2, ha="right", va="bottom", linespacing=1.8)


def main():
    data = read_models()
    matplotlib.rcParams.update({"font.family": "DejaVu Sans", "svg.fonttype": "none",
                                 "svg.hashsalt": "giza-atlas-v5-analytical-overview",
                                 "axes.unicode_minus": True})
    fig, axes = plt.subplots(2, 2, figsize=(15, 10), dpi=160, facecolor=BG)
    fig.subplots_adjust(left=.065, right=.968, bottom=.135, top=.82, hspace=.38, wspace=.24)
    fig.text(.035, .965, "GIZA  /  THE INSTRUMENT ATLAS", color=GOLD, fontsize=12,
             fontweight="bold", va="top", family="DejaVu Sans Mono")
    fig.text(.035, .925, "Native X3D projections + analytical diagrams", color=INK,
             fontsize=23, va="top", fontweight="bold")
    fig.text(.967, .959, "V5  /  GEOMETRY • SKY • EVIDENCE", color=MUTED, fontsize=9,
             ha="right", va="top", family="DejaVu Sans Mono")
    tune(axes[0, 0], "01  Contemporary construction field", "Actual native-X3D paths projected into the site’s east–north plane")
    harmonic_projection(axes[0, 0])
    tune(axes[0, 1], "02  Slice the reference. Compare a ghost.", "Ideal square-pyramid section; an independent slope experiment is violet")
    section_panel(axes[0, 1], data)
    tune(axes[1, 0], "03  An attractive fit has adjustable freedoms", "Orion belt catalogue motion at 2560 BC; unweighted orthographic comparison")
    fit_panel(axes[1, 0], data)
    tune(axes[1, 1], "04  Almost identical. Precisely different.", "The π-like and φ-like relationships share a single slope dependency")
    slope_panel(axes[1, 1], data)
    fig.text(.035, .078, "MODEL ≠ MEASUREMENT ≠ HISTORICAL INTENT", color=GOLD, fontsize=10,
             fontweight="bold", family="DejaVu Sans Mono")
    fig.text(.035, .052,
             "This is an exact-data technical illustration, not a v5 WebGL screenshot or a GPU rendering test. The flower-of-life and spiral are contemporary art overlays.\n"
             "Sources: retained v4 stage-data / HYG v4.1 (David Nash, CC BY-SA 4.0); native instruments.x3d; application instrument-math.mjs. No archaeological covariance or statistical significance is inferred.",
             color=MUTED, fontsize=8, va="top", linespacing=1.6)
    OUT.mkdir(exist_ok=True)
    fig.savefig(OUT / "instrument-overview.png", dpi=160, facecolor=BG,
                metadata={"Title": "Native X3D projections + analytical diagrams", "Software": "Matplotlib analytical projection"})
    fig.savefig(OUT / "instrument-overview.svg", facecolor=BG,
                metadata={"Title": "Native X3D projections + analytical diagrams", "Date": None,
                          "Description": "Scientific technical illustration; not a v5 WebGL screenshot or browser rendering test."})
    svg_path = OUT / "instrument-overview.svg"
    svg_path.write_text("\n".join(line.rstrip() for line in svg_path.read_text().splitlines()) + "\n")
    plt.close(fig)
    print(OUT / "instrument-overview.png")
    print(OUT / "instrument-overview.svg")


if __name__ == "__main__":
    main()
