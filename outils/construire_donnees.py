#!/usr/bin/env python3
"""Génère les fichiers de données d'Atlo (dossier data/).

Sources ouvertes, téléchargées dans un dossier de cache :
  - Natural Earth 5.x (domaine public) : régions (admin-1), villes, contours des pays ;
  - mledoze/countries (ODbL 1.0) : noms, capitales, langues, monnaies, indicatifs ;
  - countries-and-timezones (MIT) : fuseaux horaires par pays ;
  - outils/referentiels.py et outils/sites.txt : saisies éditoriales d'Atlo.

Usage :
  python3 outils/construire_donnees.py --cache /chemin/cache [--reference unesco.json]

Dépendance : shapely >= 2 (pip install shapely). Node.js sert à lire le paquet
countries-and-timezones.
"""
import argparse
import io
import json
import math
import os
import re
import subprocess
import sys
import tarfile
import unicodedata
import urllib.request
from collections import Counter, defaultdict

from shapely.geometry import Point, shape, MultiPolygon, Polygon
from shapely.ops import unary_union
from shapely.strtree import STRtree

ICI = os.path.dirname(os.path.abspath(__file__))
RACINE = os.path.dirname(ICI)
sys.path.insert(0, ICI)
import referentiels as R  # noqa: E402

NE = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/"
SOURCES = {
    "admin1.geojson": NE + "ne_10m_admin_1_states_provinces.geojson",
    "villes.geojson": NE + "ne_10m_populated_places.geojson",
    "monde110.geojson": NE + "ne_110m_admin_0_countries.geojson",
    "pays.json": "https://raw.githubusercontent.com/mledoze/countries/master/countries.json",
}
FUSEAUX_NPM = "https://registry.npmjs.org/countries-and-timezones/-/countries-and-timezones-3.10.0.tgz"

LANGUES = ("fr", "en", "es", "ar")

# Codes Natural Earth hors ISO → code ISO retenu (None = ignoré).
CODES_NE = {
    "SOL": "SO", "CYN": "CY", "KOS": "XK", "KAB": "KZ",
    "ESB": None, "WSB": None, "KAS": None, "IOA": None, "USG": None,
    "CSI": None, "PGA": None, "CLP": None,
}
UNITES_A_PART = {"Svalbard": "SJ", "Bouvet Island": "BV"}

# ISO 639-2/3 (mledoze) → ISO 639-1 quand il existe.
ISO639 = {
    "afr": "af", "amh": "am", "ara": "ar", "aym": "ay", "aze": "az", "bel": "be", "ben": "bn",
    "bis": "bi", "bos": "bs", "bul": "bg", "cat": "ca", "ces": "cs", "cha": "ch", "dan": "da",
    "deu": "de", "div": "dv", "dzo": "dz", "ell": "el", "eng": "en", "est": "et", "fas": "fa",
    "fij": "fj", "fin": "fi", "fra": "fr", "gle": "ga", "glv": "gv", "grn": "gn", "guj": "gu",
    "hat": "ht", "heb": "he", "hin": "hi", "hmo": "ho", "hrv": "hr", "hun": "hu", "hye": "hy",
    "ind": "id", "isl": "is", "ita": "it", "jpn": "ja", "kal": "kl", "kat": "ka", "kaz": "kk",
    "khm": "km", "kin": "rw", "kir": "ky", "kon": "kg", "kor": "ko", "kur": "ku", "lao": "lo",
    "lat": "la", "lav": "lv", "lin": "ln", "lit": "lt", "ltz": "lb", "mah": "mh", "mkd": "mk",
    "mlg": "mg", "mlt": "mt", "mon": "mn", "mri": "mi", "msa": "ms", "mya": "my", "nau": "na",
    "nbl": "nr", "nde": "nd", "nep": "ne", "nld": "nl", "nno": "nn", "nob": "nb", "nor": "no",
    "nya": "ny", "orm": "om", "pol": "pl", "por": "pt", "pus": "ps", "que": "qu", "roh": "rm",
    "ron": "ro", "run": "rn", "rus": "ru", "sag": "sg", "sin": "si", "slk": "sk", "slv": "sl",
    "smo": "sm", "sna": "sn", "som": "so", "sot": "st", "spa": "es", "sqi": "sq", "srp": "sr",
    "ssw": "ss", "swa": "sw", "swe": "sv", "tam": "ta", "tet": "tet", "tgk": "tg", "tha": "th",
    "tir": "ti", "ton": "to", "tsn": "tn", "tso": "ts", "tuk": "tk", "tur": "tr", "ukr": "uk",
    "urd": "ur", "uzb": "uz", "ven": "ve", "vie": "vi", "xho": "xh", "zho": "zh", "zul": "zu",
    "kon": "kg", "tvl": "tvl", "mfe": "mfe", "crs": "crs",
}

CONTINENTS = {
    "Africa": "af", "Asia": "as", "Europe": "eu", "Oceania": "oc", "Antarctic": "an",
    "North America": "na", "Central America": "na", "Caribbean": "na", "South America": "sa",
}


# ---------------------------------------------------------------- utilitaires
def telecharger(cache):
    os.makedirs(cache, exist_ok=True)
    for nom, url in SOURCES.items():
        chemin = os.path.join(cache, nom)
        if not os.path.exists(chemin):
            print("Téléchargement", url)
            urllib.request.urlretrieve(url, chemin)
    fuseaux = os.path.join(cache, "fuseaux.json")
    if not os.path.exists(fuseaux):
        print("Téléchargement", FUSEAUX_NPM)
        donnees = urllib.request.urlopen(FUSEAUX_NPM).read()
        with tarfile.open(fileobj=io.BytesIO(donnees)) as tar:
            js = tar.extractfile("package/dist/index.js").read().decode()
        script = ("const m={exports:{}};(function(module,exports){" + js +
                  "})(m,m.exports);const ct=m.exports;const o={};"
                  "for(const [k,v] of Object.entries(ct.getAllCountries()))o[k]=v.timezones;"
                  "process.stdout.write(JSON.stringify(o));")
        sortie = subprocess.run(["node", "-e", script], capture_output=True, text=True, check=True).stdout
        with open(fuseaux, "w") as f:
            f.write(sortie)


def lire_json(cache, nom):
    with open(os.path.join(cache, nom), encoding="utf-8") as f:
        return json.load(f)


def encoder(coords, facteur):
    """Polyligne encodée (algorithme Google) ; coords = [(lon, lat), ...]."""
    sortie, plat, plon = [], 0, 0
    for lon, lat in coords:
        ilat, ilon = round(lat * facteur), round(lon * facteur)
        for v in (ilat - plat, ilon - plon):
            v = ~(v << 1) if v < 0 else v << 1
            while v >= 0x20:
                sortie.append(chr((0x20 | (v & 0x1F)) + 63))
                v >>= 5
            sortie.append(chr(v + 63))
        plat, plon = ilat, ilon
    return "".join(sortie)


def anneaux(geom, tolerance, facteur, aire_min=0.0):
    """Anneaux simplifiés et encodés, séparés par une espace (règle pair-impair)."""
    g = geom.simplify(tolerance, preserve_topology=True) if tolerance else geom
    parts = list(g.geoms) if isinstance(g, MultiPolygon) else [g]
    parts = [p for p in parts if isinstance(p, Polygon) and not p.is_empty]
    if not parts:
        return ""
    plus_grand = max(parts, key=lambda p: p.area)
    gardes = [p for p in parts if p is plus_grand or p.area >= aire_min]
    textes = []
    for p in gardes:
        for anneau in [p.exterior, *p.interiors]:
            pts = list(anneau.coords)
            if len(pts) >= 4:
                textes.append(encoder(pts, facteur))
    return " ".join(textes)


def boite(geom):
    """[ouest, sud, est, nord] ; si l'objet chevauche l'antiméridien, est > 180."""
    w, s, e, n = geom.bounds
    if e - w > 180:
        xs = []
        parts = list(geom.geoms) if hasattr(geom, "geoms") else [geom]
        for p in parts:
            px0, _, px1, _ = p.bounds
            xs.append((px0 + 360 if px1 < 0 else px0, px1 + 360 if px1 < 0 else px1))
        w2, e2 = min(x[0] for x in xs), max(x[1] for x in xs)
        if e2 - w2 < e - w:
            w, e = w2, e2
    return [round(w, 3), round(s, 3), round(e, 3), round(n, 3)]


def noms(p, prefixe="name_", repli="name"):
    base = p.get(repli) or ""
    return [(p.get(prefixe + l) or base).strip() for l in LANGUES]


def compacter_noms(liste):
    return liste[0] if len(set(liste)) == 1 else liste


def slug(texte):
    t = unicodedata.normalize("NFKD", texte).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", t).strip("-")


def ecrire_js(chemin, entete, contenu):
    os.makedirs(os.path.dirname(chemin), exist_ok=True)
    with open(chemin, "w", encoding="utf-8") as f:
        f.write("/* " + entete + " — généré par outils/construire_donnees.py, ne pas modifier à la main. */\n")
        f.write(contenu)
        f.write("\n")


def js(valeur):
    return json.dumps(valeur, ensure_ascii=False, separators=(",", ":"))


def distance_km(lat1, lon1, lat2, lon2):
    r = math.pi / 180
    a = (math.sin((lat2 - lat1) * r / 2) ** 2 +
         math.cos(lat1 * r) * math.cos(lat2 * r) * math.sin((lon2 - lon1) * r / 2) ** 2)
    return 12742 * math.asin(math.sqrt(a))


# ---------------------------------------------------------------- régions
def code_unite(p):
    if p.get("name") in UNITES_A_PART and p.get("adm0_a3") == "NOR":
        return UNITES_A_PART[p["name"]]
    code = p.get("iso_a2")
    if code in ("-1", "-99", None):
        return CODES_NE.get(p.get("adm0_a3"))
    if code == "FR" and p.get("region") in R.OUTRE_MER:
        return R.OUTRE_MER[p["region"]]
    return code


def cle_groupe(code, p):
    if code in R.REGROUPER_PAR_REGION and p.get("region"):
        return p["region"]
    if code == "GB" and R.REGROUPER_GB:
        return p["region"] if p.get("geonunit") == "England" else p.get("geonunit")
    return None


def construire_regions(admin1):
    """Renvoie {code: [ {noms, geom, wikidata} ]} ; unités regroupées si besoin."""
    par_pays = defaultdict(list)
    for f in admin1["features"]:
        p = f["properties"]
        code = code_unite(p)
        if not code or not f.get("geometry"):
            continue
        geom = shape(f["geometry"])
        if not geom.is_valid:
            geom = geom.buffer(0)
        par_pays[code].append((p, geom))

    regions = {}
    for code, unites in par_pays.items():
        groupes = defaultdict(list)
        isolees = []
        for p, geom in unites:
            cle = cle_groupe(code, p)
            (groupes[cle].append((p, geom)) if cle else isolees.append((p, geom)))
        liste = []
        for cle, membres in groupes.items():
            geom = unary_union([g for _, g in membres])
            nom = R.NOMS_REGIONS.get(cle)
            liste.append({
                "noms": [nom[l] for l in LANGUES] if nom else [cle] * 4,
                "geom": geom, "wd": None,
            })
        for p, geom in isolees:
            nom = R.NOMS_REGIONS.get(p.get("name"))
            liste.append({
                "noms": [nom[l] for l in LANGUES] if nom else noms(p),
                "geom": geom, "wd": p.get("wikidataid"),
            })
        liste.sort(key=lambda r: slug(r["noms"][0]))
        regions[code] = liste
    return regions


def indexer(regions_pays):
    geoms = [r["geom"] for r in regions_pays]
    return STRtree(geoms), geoms


def region_du_point(index, lat, lon, tolerance=0.35):
    if not index:
        return -1
    arbre, geoms = index
    pt = Point(lon, lat)
    for i in arbre.query(pt, predicate="intersects"):
        return int(i)
    i = arbre.nearest(pt)
    if i is not None and geoms[i].distance(pt) <= tolerance:
        return int(i)
    return -1


# ---------------------------------------------------------------- pays
def boites_pays(regions):
    """Boîte de la partie principale (vue carte) et boîte complète (géolocalisation)."""
    sortie = {}
    for code, liste in regions.items():
        geom = unary_union([r["geom"] for r in liste])
        parts = list(geom.geoms) if isinstance(geom, MultiPolygon) else [geom]
        # On part de la plus grande terre et on ajoute les autres (≥ 1 % de la surface)
        # tant que la vue reste lisible : l'Indonésie garde Sumatra, les États-Unis pas l'Alaska.
        parts.sort(key=lambda p: p.area, reverse=True)
        total = sum(p.area for p in parts)
        w0, s0, e0, n0 = parts[0].bounds
        limite = max(50, 1.3 * max(e0 - w0, n0 - s0))
        gardes, (w, s, e, n) = [parts[0]], parts[0].bounds
        for p in parts[1:]:
            if p.area < 0.01 * total:
                break
            pw, ps, pe, pn = p.bounds
            nw, ns, ne_, nn = min(w, pw), min(s, ps), max(e, pe), max(n, pn)
            if ne_ - nw <= limite and nn - ns <= limite:
                gardes.append(p)
                w, s, e, n = nw, ns, ne_, nn
        vue = boite(unary_union(gardes))
        complete = boite(geom)
        sortie[code] = (vue, complete, geom)
    return sortie


def indicatif(idd):
    racine = idd.get("root") or ""
    suffixes = idd.get("suffixes") or []
    if not racine:
        return ""
    return racine + suffixes[0] if len(suffixes) == 1 else racine


def construire_pays(cache, regions, capitales, fuseaux_villes):
    pays_src = lire_json(cache, "pays.json")
    fuseaux = lire_json(cache, "fuseaux.json")
    boites = boites_pays(regions)
    sortie = []
    for c in pays_src:
        code = c["cca2"]
        tr = c.get("translations", {})
        nom = [
            tr.get("fra", {}).get("common") or c["name"]["common"],
            c["name"]["common"],
            tr.get("spa", {}).get("common") or c["name"]["common"],
            tr.get("ara", {}).get("common") or c["name"]["common"],
        ]
        sous_region = c.get("subregion") or ""
        continent = CONTINENTS.get(sous_region) or CONTINENTS.get(c.get("region"), "an")
        cap = capitales.get(code)
        lat, lon = c.get("latlng") or [0, 0]
        entree = {"c": code, "n": nom, "k": continent}
        if cap:
            entree["cap"] = cap
        elif c.get("capital") and R.CAPITALES_CORRIGEES.get(code, 0) is not None:
            entree["cap"] = {"n": c["capital"][0], "ll": [round(lat, 3), round(lon, 3)]}
        if code in boites:
            vue, complete, _ = boites[code]
            entree["bb"] = vue
            if complete != vue:
                entree["bx"] = complete
        entree["ll"] = [round(lat, 3), round(lon, 3)]
        if c.get("area"):
            entree["a"] = round(c["area"])
        langues = [ISO639.get(k, k) for k in (c.get("languages") or {})]
        if langues:
            entree["l"] = langues
        monnaies = list((c.get("currencies") or {}).keys())
        if monnaies:
            entree["m"] = monnaies
        tel = indicatif(c.get("idd") or {})
        if tel:
            entree["t"] = tel
        if code in R.CONDUITE_A_GAUCHE:
            entree["g"] = 1
        zones = list(fuseaux.get(code) or [])
        cap_tz = (cap or {}).get("tz")
        if cap_tz:
            zones = [cap_tz] + [z for z in zones if z != cap_tz]
        if not zones and fuseaux_villes.get(code):
            zones = [fuseaux_villes[code].most_common(1)[0][0]]
        if zones:
            entree["z"] = zones
        if code in R.URGENCES:
            entree["u"] = R.URGENCES[code]
        if code in R.PRISES:
            types, tension = R.PRISES[code]
            entree["p"] = types
            entree["v"] = tension
        if c.get("independent"):
            entree["i"] = 1
        if code in regions:
            entree["r"] = 1
        sortie.append(entree)
    sortie.sort(key=lambda e: e["c"])
    return sortie


# ---------------------------------------------------------------- villes
def construire_villes(villes_src, regions, index_regions, pays_iso3, capitales_src):
    par_pays = defaultdict(list)
    capitales = {}
    candidats_cap = defaultdict(list)
    fuseaux = defaultdict(Counter)
    geoms_outremer = {code: unary_union([r["geom"] for r in regions[code]])
                      for code in R.OUTRE_MER.values() if code in regions}
    for f in villes_src["features"]:
        p = f["properties"]
        code = p.get("ISO_A2")
        if code in ("-99", "-1", None):
            code = CODES_NE.get(p.get("ADM0_A3")) or pays_iso3.get(p.get("ADM0_A3"))
        if not code:
            continue
        lon, lat = f["geometry"]["coordinates"][:2]
        if code == "FR" and (lon < -30 or lat < 30 or lon > 30):
            pt = Point(lon, lat)
            code = next((c for c, g in geoms_outremer.items() if g.distance(pt) < 0.3), code)
        classe = p.get("FEATURECLA") or ""
        cls = 0 if classe.startswith("Admin-0 capital") and not classe.endswith("alt") else (
            1 if "Admin-1" in classe or "Admin-0 region" in classe else 2)
        nom = [(p.get("NAME_" + l.upper()) or p.get("NAME") or "").strip() for l in LANGUES]
        tz = p.get("TIMEZONE")
        if tz:
            fuseaux[code][tz] += 1
        reg = region_du_point(index_regions.get(code), lat, lon)
        ville = [compacter_noms(nom), round(lat, 4), round(lon, 4), int(p.get("POP_MAX") or 0), cls, reg, tz or ""]
        par_pays[code].append(ville)
        if classe.startswith("Admin-0 capital"):
            candidats_cap[code].append((p, nom, lat, lon, tz))
    for code, candidats in candidats_cap.items():
        voulu = slug((capitales_src.get(code) or [""])[0])
        choisi = next((c for c in candidats if voulu and voulu in {slug(c[0].get("NAME") or ""), slug(c[0].get("NAMEASCII") or ""), slug(c[0].get("NAME_EN") or "")}), None)
        principales = [c for c in candidats if not c[0]["FEATURECLA"].endswith("alt")] or candidats
        p, nom, lat, lon, tz = choisi or max(principales, key=lambda c: c[0].get("POP_MAX") or 0)
        capitales[code] = {"n": compacter_noms(nom), "ll": [round(lat, 4), round(lon, 4)]}
        if tz:
            capitales[code]["tz"] = tz
    for code, corrigee in R.CAPITALES_CORRIGEES.items():
        if corrigee is None:
            capitales.pop(code, None)
        else:
            capitales[code] = corrigee
    for code, liste in par_pays.items():
        principal = fuseaux[code].most_common(1)[0][0] if fuseaux[code] else ""
        for v in liste:
            if not v[6]:
                v[6] = principal
        liste.sort(key=lambda v: (v[4], -v[3]))
    return par_pays, capitales, fuseaux


# ---------------------------------------------------------------- sites
def lire_sites():
    sites = []
    with open(os.path.join(ICI, "sites.txt"), encoding="utf-8") as f:
        for n, ligne in enumerate(f, 1):
            ligne = ligne.rstrip("\n")
            if not ligne.strip() or ligne.startswith("#"):
                continue
            champs = ligne.split("|")
            if len(champs) != 9:
                raise SystemExit(f"sites.txt ligne {n} : 9 champs attendus, {len(champs)} trouvés")
            pays, cat, lat, lon, unesco, wfr, wen, lfr, len_ = champs
            sites.append({
                "ligne": n, "pays": pays.split(), "cat": cat, "lat": float(lat), "lon": float(lon),
                "unesco": int(unesco) if unesco else 0, "wfr": wfr, "wen": wen,
                "fr": lfr or re.sub(r"\s*\([^)]*\)$", "", wfr),
                "en": len_ or re.sub(r"\s*\([^)]*\)$", "", wen),
            })
    return sites


def construire_sites(sites, regions, index_regions, reference=None):
    alertes, sortie, vus = [], [], set()
    unions = {code: unary_union([r["geom"] for r in liste]) for code, liste in regions.items()}
    ids = Counter()
    for s in sites:
        cle = (s["wen"], round(s["lat"], 2), round(s["lon"], 2))
        if cle in vus:
            alertes.append(f"ligne {s['ligne']} : doublon de « {s['wen']} »")
            continue
        vus.add(cle)
        if s["cat"] not in "HRNMVAP" or len(s["cat"]) != 1:
            alertes.append(f"ligne {s['ligne']} : catégorie inconnue {s['cat']}")
        pt = Point(s["lon"], s["lat"])
        marge = 0.5 if s["cat"] in "NP" else 0.25
        pays_ok = [c for c in s["pays"] if c in unions and unions[c].distance(pt) <= marge]
        if not pays_ok:
            proche = min(((c, g.distance(pt)) for c, g in unions.items()), key=lambda x: x[1])
            alertes.append(f"ligne {s['ligne']} : {s['fr']} hors de {'/'.join(s['pays'])} "
                           f"(plus proche : {proche[0]} à {proche[1]:.2f}°)")
        pays_region = pays_ok[0] if pays_ok else s["pays"][0]
        reg = region_du_point(index_regions.get(pays_region), s["lat"], s["lon"], tolerance=0.6)
        if reference and s["unesco"] and str(s["unesco"]) in reference:
            rlat, rlon = reference[str(s["unesco"])]
            d = distance_km(s["lat"], s["lon"], rlat, rlon)
            if d > 60:
                alertes.append(f"ligne {s['ligne']} : {s['fr']} à {d:.0f} km du point UNESCO {s['unesco']} "
                               f"({rlat:.4f}, {rlon:.4f}) — à vérifier")
        # Identifiant stable pour les liens partagés : titre Wikipédia anglais, sans parenthèse.
        base = slug(re.sub(r"\s*\([^)]*\)$", "", s["wen"])) or slug(s["en"]) or slug(s["fr"])
        ids[base] += 1
        ident = base if ids[base] == 1 else f"{base}-{ids[base]}"
        sortie.append([
            ident, " ".join(s["pays"]), s["cat"], round(s["lat"], 4), round(s["lon"], 4),
            s["unesco"], s["wfr"], s["wen"], s["fr"], s["en"], reg, pays_region,
        ])
    return sortie, alertes


# ---------------------------------------------------------------- monde
def construire_monde(monde):
    sortie = {}
    for f in monde["features"]:
        p = f["properties"]
        code = p.get("ISO_A2_EH")
        if code in ("-99", None):
            code = CODES_NE.get(p.get("ADM0_A3"))
        if not code or not f.get("geometry"):
            continue
        geom = shape(f["geometry"])
        texte = anneaux(geom, 0.08, 10)
        sortie[code] = (sortie[code] + " " + texte) if code in sortie else texte
    return sortie


# ---------------------------------------------------------------- principal
def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--cache", required=True, help="dossier des sources téléchargées")
    ap.add_argument("--reference", help="GeoJSON des sites UNESCO pour contrôler les coordonnées (non diffusé)")
    args = ap.parse_args()

    telecharger(args.cache)
    admin1 = lire_json(args.cache, "admin1.geojson")
    villes_src = lire_json(args.cache, "villes.geojson")
    monde = lire_json(args.cache, "monde110.geojson")
    pays_src = lire_json(args.cache, "pays.json")
    pays_iso3 = {c["cca3"]: c["cca2"] for c in pays_src}

    print("Régions…")
    regions = construire_regions(admin1)
    index_regions = {code: indexer(liste) for code, liste in regions.items()}

    print("Villes…")
    capitales_src = {c["cca2"]: c.get("capital") or [] for c in pays_src}
    villes, capitales, fuseaux_villes = construire_villes(villes_src, regions, index_regions, pays_iso3, capitales_src)

    print("Pays…")
    pays = construire_pays(args.cache, regions, capitales, fuseaux_villes)
    codes_pays = {p["c"] for p in pays}

    print("Sites…")
    reference = None
    if args.reference:
        ref = json.load(open(args.reference, encoding="utf-8"))
        reference = {str(f["properties"]["id"]): (f["geometry"]["coordinates"][1], f["geometry"]["coordinates"][0])
                     for f in ref["features"]}
    sites, alertes = construire_sites(lire_sites(), regions, index_regions, reference)
    inconnus = {c for s in sites for c in s[1].split() if c not in codes_pays}
    if inconnus:
        alertes.append("codes pays inconnus dans sites.txt : " + ", ".join(sorted(inconnus)))

    print("Écriture…")
    dossier = os.path.join(RACINE, "data")
    entete_sources = ("Sources : Natural Earth (domaine public), mledoze/countries (ODbL 1.0), "
                      "countries-and-timezones (MIT), saisies Atlo")
    ecrire_js(os.path.join(dossier, "pays.js"), "Atlo · pays et territoires. " + entete_sources,
              "self.ATLO_PAYS=" + js(pays) + ";")
    ecrire_js(os.path.join(dossier, "sites.js"),
              "Atlo · sites emblématiques [id, pays, catégorie, lat, lon, n° UNESCO, titre Wikipédia FR, "
              "titre Wikipédia EN, nom FR, nom EN, index de région, pays de la région]",
              "self.ATLO_SITES=" + js(sites) + ";")
    ecrire_js(os.path.join(dossier, "monde.js"),
              "Atlo · contours simplifiés des pays (Natural Earth 1:110m, polylignes encodées au 1/10 de degré)",
              "self.ATLO_MONDE=" + js(construire_monde(monde)) + ";")

    dossier_pays = os.path.join(dossier, "pays")
    for ancien in os.listdir(dossier_pays) if os.path.isdir(dossier_pays) else []:
        if ancien.endswith(".js"):
            os.remove(os.path.join(dossier_pays, ancien))
    tailles = []
    for code in sorted(set(regions) | set(villes)):
        if code not in codes_pays:
            continue
        liste_r = []
        for r in regions.get(code, []):
            geom = r["geom"]
            w, s, e, n = geom.bounds
            etendue = max(e - w, n - s)
            tol = min(0.03, max(0.003, etendue / 250))
            pt = geom.representative_point()
            liste_r.append([compacter_noms(r["noms"]), round(pt.y, 3), round(pt.x, 3), boite(geom),
                            anneaux(geom, tol, 1000, aire_min=(tol * 3) ** 2)])
        contenu = {"r": liste_r, "v": villes.get(code, [])}
        texte = "self.atloDonnees&&atloDonnees(" + js(code) + "," + js(contenu) + ");"
        ecrire_js(os.path.join(dossier_pays, code + ".js"),
                  f"Atlo · {code} : régions [noms, lat, lon, boîte, contours] et villes "
                  f"[noms, lat, lon, population, classe, région, fuseau]. Natural Earth (domaine public)", texte)
        tailles.append((len(texte), code))

    tailles.sort(reverse=True)
    print(f"{len(pays)} pays, {sum(len(v) for v in regions.values())} régions, "
          f"{sum(len(v) for v in villes.values())} villes, {len(sites)} sites")
    print("Fichiers pays les plus lourds :", ", ".join(f"{c} {t // 1024} ko" for t, c in tailles[:6]),
          f"— total {sum(t for t, _ in tailles) // 1024} ko")
    if alertes:
        print(f"\n{len(alertes)} alerte(s) :")
        for a in alertes:
            print(" -", a)


if __name__ == "__main__":
    main()
