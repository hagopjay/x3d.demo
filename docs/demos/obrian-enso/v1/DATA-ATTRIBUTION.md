# OBrian v1: data sources, attribution and takedown

The code, scenes and page are this project's own work. The data they draw belongs to the parties below. Naming a source is credit, not a claim of ownership, and not a statement that the source endorses this project. This page is not legal advice, and where a licence or term could not be confirmed it says so.

## Takedown, and how to ask

If you own or control any data listed here and want it removed or the credit changed, open an issue at https://github.com/hagopjay/x3d.demo/issues titled `Takedown: obrian-enso` and say what you want removed. Material is removed promptly after a request, without argument. Removal means deleting the files from the current tree (history can be cleaned on request). Each scene is rebuilt from the builder, so a replaced or withdrawn source is a small change.

## Summary

| layer | source | owner / author | terms | status |
|---|---|---|---|---|
| ocean temperature 0 to 300 m | NCEP GODAS `pottmp` monthly, via NOAA PSL THREDDS (`psl.noaa.gov/thredds/dodsC/Datasets/godas/pottmp.YYYY.nc`) | NOAA / NCEP Environmental Modeling Center; served by NOAA PSL | work of the US Government; PSL asks users to cite the dataset (below) | public domain, credit given; recent months near-real-time and may be revised |
| sea-surface temperature | NOAA ERSST v5 `sst.mnmean.nc`, via PSL | NOAA NCEI (Huang et al.) | US Government work | public domain, credit given |
| surface wind | NCEP/NCAR Reanalysis 1 `uwnd.sig995`, `vwnd.sig995` monthly, via PSL | NOAA NCEP / NCAR (Kalnay et al.) | US Government work | public domain, credit given |
| cross-checks | NOAA CPC `oni.ascii.txt` and `sstoi.indices` | NOAA Climate Prediction Center | US Government work | public domain, used only to check |
| coastlines | Natural Earth 50 m land (`ne_50m_land.geojson`) | Natural Earth contributors | public domain (naturalearthdata.com terms) | public domain; no endorsement implied |
| viewer | X_ITE 16.7.1 (npm package) | Holger Seelig and contributors | MIT, as the package's `LICENSE.md` states (`vendor/x_ite/LICENSE.md`) | vendored unmodified (components subset) |
| proof-of-concept pages | `studies/obrian/poc/*.html` (source only, not hosted) | the project owner; the second embeds ECMWF ERA-Interim winds, NOAA ERSST v5 and a TXLA ROMS hindcast from the xarray tutorial data | ERA-Interim and TXLA terms **not confirmed by us** | credited; included at the project owner's request as the origin of this study; not part of the hosted page |

Retrieval: GODAS, ERSST and NCEP Reanalysis subsets, CPC files and Natural Earth were fetched on 2026-11-28 (the date and tool versions are in `data/manifest.json`, with the sha256 of every stored array).

## Citations asked for

- **GODAS**: Behringer, D. W., and Y. Xue, 2004: Evaluation of the global ocean data assimilation system at NCEP: The Pacific Ocean. Preprints, 8th Symp. on Integrated Observing and Assimilation Systems for Atmosphere, Oceans, and Land Surface, AMS 84th Annual Meeting. Data provided by NOAA PSL, Boulder, Colorado, USA, https://psl.noaa.gov.
- **ERSST v5**: Huang, B., et al., 2017: Extended Reconstructed Sea Surface Temperature, Version 5 (ERSSTv5). J. Climate, 30, 8179-8205, doi:10.1175/JCLI-D-16-0836.1.
- **NCEP/NCAR Reanalysis 1**: Kalnay, E., et al., 1996: The NCEP/NCAR 40-Year Reanalysis Project. Bull. Amer. Meteor. Soc., 77, 437-471. Data provided by NOAA PSL.
- **ONI and OISST Niño indices**: NOAA Climate Prediction Center, https://www.cpc.ncep.noaa.gov/data/indices/.

These reference strings were written from memory of the publications; check them against the journals before any formal use.

## Dedication

OBrian is a codename for ocean and weather visualisation in memory of James J. O'Brien (1935-2016), Florida State University, founder of COAPS, called "Dr. El Niño" by colleagues (https://www.coaps.fsu.edu/in-memoriam-jim-o-brien). The name and dates are as published there. This project is not affiliated with or endorsed by Florida State University, COAPS or his family, and the family or COAPS has not been asked about this use. Anyone with standing who objects can use the takedown route above and the dedication is removed.

## Not a forecast

Nothing here is a forecast or a NOAA product. Monthly means of an assimilation and a reconstruction, drawn with a stated baseline (2001-2020) and a vertical exaggeration of about 5,550.
