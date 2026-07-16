/**
 * regionDeviceLogic.js
 * Auto-derives Region from country name and Device category from device model string.
 * Used across the Heaven Stat Engine for consistent classification.
 */

import { stringSimilarity } from './utils/similarity';

// ─── Region Mapping ────────────────────────────────────────────────────────────
const AFRICA_COUNTRIES = [
  'south africa','nigeria','kenya','ghana','ethiopia','tanzania','uganda',
  'senegal',"ivory coast","côte d'ivoire",'cameroon','zimbabwe','zambia',
  'mozambique','angola','namibia','botswana','rwanda','mali','morocco',
  'algeria','tunisia','egypt','libya','sudan','somalia','drc',
  'democratic republic of congo','republic of congo','gabon','malawi',
  'madagascar','mauritius','seychelles','lesotho','swaziland','eswatini',
  'sierra leone','liberia','guinea','gambia','cabo verde','cape verde',
  'togo','benin','burkina faso','niger','chad','eritrea','djibouti',
  'comoros','sao tome','equatorial guinea','central african republic',
  'south sudan','burundi',
];

const EUROPE_COUNTRIES = [
  'germany','france','united kingdom','uk','england','scotland','wales',
  'northern ireland','spain','italy','netherlands','belgium','switzerland',
  'austria','sweden','norway','denmark','finland','poland','czech republic',
  'czechia','slovakia','hungary','romania','bulgaria','greece','portugal',
  'ireland','croatia','slovenia','serbia','albania','north macedonia',
  'bosnia','montenegro','kosovo','moldova','ukraine','belarus','russia',
  'latvia','lithuania','estonia','luxembourg','malta','cyprus','iceland',
  'liechtenstein','monaco','andorra','san marino','turkey','georgia',
  'armenia','azerbaijan',
];

const ASIA_COUNTRIES = [
  'china','japan','south korea','korea','india','indonesia','philippines',
  'vietnam','thailand','malaysia','singapore','myanmar','cambodia','laos',
  'bangladesh','sri lanka','nepal','pakistan','afghanistan','iran','iraq',
  'syria','jordan','lebanon','israel','palestine','saudi arabia','uae',
  'united arab emirates','qatar','bahrain','kuwait','oman','yemen',
  'taiwan','hong kong','macau','mongolia','kazakhstan','uzbekistan',
  'kyrgyzstan','tajikistan','turkmenistan','maldives','bhutan','timor-leste',
  'brunei',
];

const AMERICA_COUNTRIES = [
  'united states','usa','us','canada','mexico','brazil','argentina',
  'colombia','chile','peru','venezuela','ecuador','bolivia','paraguay',
  'uruguay','guyana','suriname','french guiana','cuba','jamaica',
  'haiti','dominican republic','puerto rico','trinidad and tobago','trinidad',
  'barbados','bahamas','belize','guatemala','honduras','el salvador',
  'nicaragua','costa rica','panama',
];

const OCEANIA_COUNTRIES = [
  'australia','new zealand','fiji','papua new guinea','solomon islands',
  'vanuatu','samoa','tonga','kiribati','micronesia','palau','nauru',
  'tuvalu','marshall islands',
];

/**
 * Derive the official region from a country name string.
 * Returns one of: Africa, Europe, Asia, America, Oceania, or '' if unknown.
 */
export function deriveRegion(country) {
  if (!country) return '';
  const c = country.trim().toLowerCase();
  if (AFRICA_COUNTRIES.some(x => c.includes(x) || x.includes(c))) return 'Africa';
  if (EUROPE_COUNTRIES.some(x => c.includes(x) || x.includes(c))) return 'Europe';
  if (ASIA_COUNTRIES.some(x => c.includes(x) || x.includes(c))) return 'Asia';
  if (AMERICA_COUNTRIES.some(x => c.includes(x) || x.includes(c))) return 'America';
  if (OCEANIA_COUNTRIES.some(x => c.includes(x) || x.includes(c))) return 'Oceania';

  // Similarity-boosted check for spelling errors
  let bestMatch = { region: '', score: 0 };
  const checkList = (list, regionName) => {
    for (const x of list) {
      const score = stringSimilarity(c, x);
      if (score > bestMatch.score) {
        bestMatch = { region: regionName, score };
      }
    }
  };

  checkList(AFRICA_COUNTRIES, 'Africa');
  checkList(EUROPE_COUNTRIES, 'Europe');
  checkList(ASIA_COUNTRIES, 'Asia');
  checkList(AMERICA_COUNTRIES, 'America');
  checkList(OCEANIA_COUNTRIES, 'Oceania');

  if (bestMatch.score >= 0.70) {
    return bestMatch.region;
  }
  return '';
}

export const REGIONS = ['Africa', 'Europe', 'Asia', 'America', 'Oceania'];

// ─── Device Mapping ────────────────────────────────────────────────────────────

const IPHONE_KEYWORDS = ['iphone'];
const IPAD_KEYWORDS = ['ipad'];
const TABLET_KEYWORDS = [
  'tablet','tab','galaxy tab','mediapad','matepad',' pad',
  'fire hd','kindle','lenovo tab','redmi pad','poco pad',
  'realme pad','oppo pad','xperia tablet','surface',
];

/**
 * Derive the device category from a device model string.
 * Returns one of: iPhone, iPad, Tablet, Phone, or '' if unknown.
 */
export function deriveDevice(model) {
  if (!model) return '';
  const m = model.trim().toLowerCase();
  if (IPHONE_KEYWORDS.some(kw => m.includes(kw))) return 'iPhone';
  if (IPAD_KEYWORDS.some(kw => m.includes(kw))) return 'iPad';
  if (TABLET_KEYWORDS.some(kw => m.includes(kw))) return 'Tablet';

  // Word-level similarity boost for spelling errors (e.g. 'ippad', 'iphad', 'iphonee')
  const words = m.split(/[^a-z0-9]/).filter(w => w.length > 0);
  for (const w of words) {
    if (IPHONE_KEYWORDS.some(kw => stringSimilarity(w, kw) >= 0.80)) return 'iPhone';
    if (IPAD_KEYWORDS.some(kw => stringSimilarity(w, kw) >= 0.80)) return 'iPad';
    if (TABLET_KEYWORDS.some(kw => stringSimilarity(w, kw) >= 0.80)) return 'Tablet';
  }

  if (m.length > 0) return 'Phone';
  return '';
}

export const DEVICE_TYPES = ['iPhone', 'iPad', 'Tablet', 'Phone'];
