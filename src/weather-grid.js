import { search_places } from './naver-search.js';

const radians = Math.PI / 180;
const earthRadiusInGridCells = 6371.00877 / 5;
const tangent = latitude => Math.tan(Math.PI / 4 + latitude * radians / 2);
const standardLatitude = 30 * radians;
const cone = Math.log(Math.cos(standardLatitude) / Math.cos(60 * radians)) /
  Math.log(tangent(60) / tangent(30));
const scale = Math.cos(standardLatitude) * tangent(30) ** cone / cone;
const radius = latitude => earthRadiusInGridCells * scale / tangent(latitude) ** cone;
const originRadius = radius(38);

// KMA DFS Lambert grid, with reference point 126°E, 38°N at (43, 136).
export function forecastGrid({ latitude, longitude }) {
  if (!(latitude >= 31 && latitude <= 44 && longitude >= 123 && longitude <= 133)) return null;
  const angle = (longitude - 126) * radians * cone;
  const x = Math.round(radius(latitude) * Math.sin(angle) + 43);
  const y = Math.round(originRadius - radius(latitude) * Math.cos(angle) + 136);
  return x >= 1 && x <= 149 && y >= 1 && y <= 253 ? [x, y] : null;
}

function localityName(name) {
  const aliases = {
    경기도: '경기', 충청북도: '충북', 충청남도: '충남', 전라북도: '전북', 전라남도: '전남',
    경상북도: '경북', 경상남도: '경남', 전북특별자치도: '전북', 강원특별자치도: '강원', 대구: '대구',
  };
  return aliases[name] ?? name.replace(/(?:특별자치시|특별자치도|특별시|광역시|[시군구도])$/, '');
}

export async function findWeatherGrid(region) {
  const tokens = region.split(/\s+/);
  const target = tokens.at(-1);
  const suffix = target.endsWith('군') ? '군청' : target.endsWith('구') && target !== '대구' ? '구청'
    : /[읍면동]$/.test(target) ? '행정복지센터' : '시청';
  const officeName = localityName(target) + suffix;
  const qualifier = tokens.slice(0, -1).join(' ');
  const matches = new Map();
  const exactMatches = new Map();
  try {
    const places = await search_places(qualifier || region, officeName);
    for (const place of places) {
      const name = place.name.replace(/\s/g, '');
      if (!place.coordinates || !(name.startsWith(officeName) || name.endsWith(suffix))) continue;
      const address = place.address.split(/\s+/).slice(0, 5).map(localityName);
      let cursor = 0;
      for (const part of address) {
        if (part === localityName(tokens[cursor] ?? '')) cursor++;
      }
      if (cursor !== tokens.length) continue;
      const grid = forecastGrid(place.coordinates);
      if (!grid) continue;
      matches.set(grid.join(','), grid);
      if (name === officeName) exactMatches.set(grid.join(','), grid);
    }
  } catch {
    return null;
  }
  const candidates = exactMatches.size ? exactMatches : matches;
  return candidates.size === 1 ? candidates.values().next().value : null;
}
