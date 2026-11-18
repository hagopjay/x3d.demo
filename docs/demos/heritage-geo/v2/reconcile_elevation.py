#!/usr/bin/env python3
"""Reconcile USGS EPQS (3DEP 1 m) with the Drillfield DSM (heights relative to 617 m).
python3 -I reconcile_elevation.py  -> data/elevation-reconcile.json  (needs network; stdlib only)"""
import re, json, math, statistics, urllib.request, concurrent.futures as cf, pathlib
HERE=pathlib.Path(__file__).resolve().parent
X3D=HERE.parent.parent/'gobbler-worlds-within/v1/data/worlds/drillfield/drillfield.x3d'
txt=X3D.read_text(encoding='utf8')
h=[float(v) for v in re.search(r"<ElevationGrid DEF='DSM'[^>]*height='([^']+)'",txt).group(1).split()]
NX,NZ=401,301; assert len(h)==NX*NZ
def dsm(ix,iz): return h[iz*NX+ix]
C=(37.2284,-80.4234)   # assumed centre of the tile (S): the demo's own description says only 37.23 N
def epqs(lat,lon):
    u=f'https://epqs.nationalmap.gov/v1/json?x={lon:.7f}&y={lat:.7f}&units=Meters&wkid=4326&includeDate=false'
    for _ in range(3):
        try: return float(json.load(urllib.request.urlopen(u,timeout=30))['value'])
        except Exception: pass
    return None
def ll(dx_east,dz_north): return C[0]+dz_north/111132.0, C[1]+dx_east/(111320.0*math.cos(math.radians(C[0])))
pts=[(ix,iz) for iz in range(10,301,30) for ix in range(10,401,30)]
def job(p,zsouth):
    ix,iz=p; dx=ix-200; dz=(iz-150)
    lat,lon=ll(dx,-dz if zsouth else dz); return p,epqs(lat,lon)
res={}
for zs in (True,False):
    with cf.ThreadPoolExecutor(6) as ex: r=list(ex.map(lambda p:job(p,zs),pts))
    r=[(p,e) for p,e in r if e is not None]
    dif=[e-(617+dsm(*p)) for p,e in r]
    es=[e for _,e in r]; ds=[617+dsm(*p) for p,_ in r]
    n=len(r); me,md=sum(es)/n,sum(ds)/n
    cov=sum((a-me)*(b-md) for a,b in zip(es,ds)); cor=cov/math.sqrt(sum((a-me)**2 for a in es)*sum((b-md)**2 for b in ds))
    res['z_south' if zs else 'z_north']=dict(n=n,corr=round(cor,3),diff_median=round(statistics.median(dif),2),diff_min=round(min(dif),2),diff_max=round(max(dif),2),epqs_min=min(es),epqs_max=max(es),dsm_abs_min=round(min(ds),2),dsm_abs_max=round(max(ds),2))
out=dict(assumed_centre=C,grid_spacing_m=30,samples_per_orientation=len(pts),epqs="USGS EPQS v1 (3DEP 1 m), queried 18 Nov 2026",results=res)
(HERE/'data/elevation-reconcile.json').write_text(json.dumps(out,indent=1)); print(json.dumps(out,indent=1))
