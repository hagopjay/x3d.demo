# Data attribution, Demo 75 (Style Loom)

| data | source | licence / terms | how it is used here |
|---|---|---|---|
| Names and components of the 260 concrete X3D 4.0 nodes; three.js bridge status per node | x3d.loom `x3d.threejs/bridge/NODES.json` (this project). Node and component names come from ISO/IEC 19775-1, the X3D 4.0 Architecture, published by the [Web3D Consortium](https://www.web3d.org/documents/specifications/19775-1/V4.0/) | names of a published open standard; our own status data | district = component, alert = "not yet drawn by the three.js bridge" |
| Number of declared fields per node | [x3d.py](https://pypi.org/project/x3d/) 4.0.65.8, the X3D Python package (author on PyPI: Don Brutzman; home page [web3d.org/x3d/stylesheets/python](https://www.web3d.org/x3d/stylesheets/python/python.html)); counted with `FIELD_DECLARATIONS()` | the package's own terms, see its home page (the PyPI licence field is empty) | height of each building. Counts only; no x3d.py code is redistributed |
| X_ITE 16.7.1 | [create3000/x_ite](https://github.com/create3000/x_ite), Holger Seelig | MIT, vendored copy with its licence in `../../blenderizer-nexus/v1/observatory/vendor/x_ite/` | draws the worlds |
| Colour-vision simulation matrices | G. M. Machado, M. M. Oliveira, L. A. F. Fernandes, "A Physiologically-based Model for Simulation of Color Vision Deficiency", IEEE TVCG 15(6), 2009, severity 1.0 | published scientific result, cited | rule G4 |
| OKLab | Björn Ottosson, ["A perceptual color space for image processing"](https://bottosson.github.io/posts/oklab/), 2020 | public domain / MIT per the author | colour distance and lightness in every rule |
| Viridis stops, Okabe-Ito categorical colours (Viridis Lab style) | viridis by S. van der Walt and N. Smith (matplotlib), CC0; Okabe and Ito, "Color Universal Design", 2002 | CC0; published, cited | 5 ramp stops, 8 categorical colours |

The style names (Bauhaus, Risograph and others) describe a historical lineage or a printing process; no logo, artwork or protected design is reproduced. "Risograph" is a trademark of Riso Kagaku Corporation, used here descriptively.

**Takedown.** If you hold rights in anything on this page and want it changed or removed, open an issue at https://github.com/hagopjay/x3d.demo/issues and it will be taken down promptly while the question is looked at.
