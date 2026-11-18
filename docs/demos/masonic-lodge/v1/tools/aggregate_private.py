#!/usr/bin/env python3
"""PRIVATE aggregate of US Masonic buildings from OpenStreetMap (ODbL), one Overpass query per state.
Output goes OUTSIDE the repo (default /mnt/project-files/lodge-private/). NEVER commit or publish the output:
Grand Lodges should be contacted before any aggregate list is published (see MasonicLodges.md).
Usage: python3 aggregate_private.py [outdir]   (needs network access to an Overpass endpoint; ~51 queries, 20 s apart)"""
import csv, json, sys, time, urllib.parse, urllib.request
OUT = sys.argv[1] if len(sys.argv) > 1 else '/mnt/project-files/lodge-private'
EP = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']
STATES = "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split()
def q(st):
    return f'''[out:json][timeout:180];area["ISO3166-2"="US-{st}"]->.a;(nwr["club"="freemasonry"](area.a);nwr["fraternity"="freemasonry"](area.a);nwr["building"]["name"~"Masonic|Freemason",i](area.a);nwr["amenity"="community_centre"]["name"~"Masonic",i](area.a););out center tags;'''
def run(st):
    last = None
    for u in EP:
        try:
            req = urllib.request.Request(u, data=urllib.parse.urlencode({'data': q(st)}).encode(), headers={'User-Agent': 'x3d-lodge-xr private aggregate (contact: repo owner)'})
            return json.load(urllib.request.urlopen(req, timeout=240))
        except Exception as e: last = e
    raise last
rows, seen = [], set()
for st in STATES:
    try: j = run(st)
    except Exception as e: print(st, 'FAILED', e); continue
    n = 0
    for el in j['elements']:
        c = {'lat': el.get('lat'), 'lon': el.get('lon')} if el['type'] == 'node' else el.get('center')
        k = f"{el['type']}/{el['id']}"
        if not c or k in seen: continue
        seen.add(k); t = el.get('tags', {}); n += 1
        rows.append(dict(osm=k, state=st, name=t.get('name', ''), lat=c['lat'], lon=c['lon'], street=t.get('addr:street', ''), housenumber=t.get('addr:housenumber', ''), city=t.get('addr:city', ''), website=t.get('website', '')))
    print(st, n, flush=True); time.sleep(20)
with open(f'{OUT}/us-masonic-osm.csv', 'w', newline='') as f:
    w = csv.DictWriter(f, fieldnames=list(rows[0])); w.writeheader(); w.writerows(rows)
json.dump({'type': 'FeatureCollection', 'features': [{'type': 'Feature', 'geometry': {'type': 'Point', 'coordinates': [r['lon'], r['lat']]}, 'properties': {k: r[k] for k in ('osm', 'state', 'name')}} for r in rows]}, open(f'{OUT}/us-masonic-osm.geojson', 'w'))
print('total', len(rows), 'source: OpenStreetMap contributors, ODbL; PRIVATE, do not publish')
