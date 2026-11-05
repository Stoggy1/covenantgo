// Regenerates the demo JSON in /data. Run: node tools/generate-sample-data.mjs
// All partners are FICTIONAL placeholders for the MVP demo.
import { writeFileSync, mkdirSync } from 'node:fs';

const partners = [
  ['Casa Marea Resort', 'Marea Hospitality', 'Resort', 'MX', 'Quintana Roo', 'Tulum'],
  ['Hotel Coral Azul', 'Azul Collection', 'Hotel', 'MX', 'Quintana Roo', 'Cancún'],
  ['La Selva Boutique', 'Independent', 'Boutique', 'MX', 'Quintana Roo', 'Playa del Carmen'],
  ['Pacific Cliffs Cabo', 'Horizon Stays Group', 'Resort', 'MX', 'Baja California Sur', 'Los Cabos'],
  ['Villa Sol Vallarta', 'Azul Collection', 'Resort', 'MX', 'Jalisco', 'Puerto Vallarta'],
  ['Casa Tapatía', 'Independent', 'Boutique', 'MX', 'Jalisco', 'Guadalajara'],
  ['Roma Norte House', 'Urbano Hotels', 'Boutique', 'MX', 'Ciudad de México', 'Mexico City'],
  ['Oaxaca Mezcal Trails', 'Independent', 'Tour', 'MX', 'Oaxaca', 'Oaxaca City'],
  ['Hacienda Blanca', 'Urbano Hotels', 'Hotel', 'MX', 'Yucatán', 'Mérida'],
  ['Casa Colonial SMA', 'Independent', 'Boutique', 'MX', 'Guanajuato', 'San Miguel de Allende'],
  ['Surf Shack Sayulita', 'Independent', 'Adventure', 'MX', 'Nayarit', 'Sayulita'],
  ['Cenote Explorers', 'Independent', 'Adventure', 'MX', 'Quintana Roo', 'Tulum'],
  ['Cabo Sail & Snorkel', 'Independent', 'Tour', 'MX', 'Baja California Sur', 'Los Cabos'],
  ['Chapultepec Art Walks', 'Independent', 'Attraction', 'MX', 'Ciudad de México', 'Mexico City'],
  ['The Sunset Arlo', 'Horizon Stays Group', 'Hotel', 'US', 'California', 'Los Angeles'],
  ['Harborview Inn', 'Coastline Hospitality', 'Hotel', 'US', 'California', 'San Diego'],
  ['Desert Bloom Palms', 'Independent', 'Boutique', 'US', 'California', 'Palm Springs'],
  ['Biscayne Bay Suites', 'Coastline Hospitality', 'Hotel', 'US', 'Florida', 'Miami'],
  ['Magic Lakes Resort', 'Horizon Stays Group', 'Resort', 'US', 'Florida', 'Orlando'],
  ['Conch Key Cottages', 'Independent', 'Boutique', 'US', 'Florida', 'Key West'],
  ['The Hudson Loft', 'Metro Hotel Co.', 'Hotel', 'US', 'New York', 'New York City'],
  ['Neon Strip Tower', 'Metro Hotel Co.', 'Resort', 'US', 'Nevada', 'Las Vegas'],
  ['Live Oak Lodge', 'Independent', 'Boutique', 'US', 'Texas', 'Austin'],
  ['Riverwalk Grand', 'Lone Star Hospitality', 'Hotel', 'US', 'Texas', 'San Antonio'],
  ['Honky Tonk House', 'Lone Star Hospitality', 'Hotel', 'US', 'Tennessee', 'Nashville'],
  ['Bayou Jazz & Swamp Tours', 'Independent', 'Tour', 'US', 'Louisiana', 'New Orleans'],
  ['Aloha Tides', 'Coastline Hospitality', 'Resort', 'US', 'Hawaii', 'Honolulu'],
  ['Saguaro Spa Retreat', 'Horizon Stays Group', 'Resort', 'US', 'Arizona', 'Scottsdale'],
  ['Windy City Social', 'Metro Hotel Co.', 'Hotel', 'US', 'Illinois', 'Chicago'],
  ['Peachtree Food Crawl', 'Independent', 'Tour', 'US', 'Georgia', 'Atlanta'],
  ['Skyline Helicopter Tours', 'Independent', 'Attraction', 'US', 'Nevada', 'Las Vegas'],
  ['Everglades Airboat Co.', 'Independent', 'Adventure', 'US', 'Florida', 'Miami'],
  ['Red Rock Jeep Adventures', 'Independent', 'Adventure', 'US', 'Arizona', 'Scottsdale'],
  ['Harbor Lights Cruises', 'Independent', 'Attraction', 'US', 'New York', 'New York City'],
  ['Summit Peak Chalet', 'Horizon Stays Group', 'Resort', 'US', 'Colorado', 'Aspen'],
];

// Two partner categories; "type" is the sub-type shown on cards.
const categoryOf = { Hotel: 'Hotels & Resorts', Resort: 'Hotels & Resorts', Boutique: 'Hotels & Resorts', Tour: 'Things to Do', Attraction: 'Things to Do', Adventure: 'Things to Do' };
const hues = { Resort: '#ff3b5c', Hotel: '#25f4ee', Boutique: '#b388ff', Tour: '#ffb547', Attraction: '#ff8a3d', Adventure: '#5cff9d' };
const slug = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

let seed = 42;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const pickSome = (arr, min, max) => {
  const n = min + Math.floor(rand() * (max - min + 1));
  return [...arr].sort(() => rand() - 0.5).slice(0, n);
};

const partnerRows = partners.map(([name, group, type, country, state, city]) => ({
  id: `ptn_${slug(name)}`,
  name,
  group,
  category: categoryOf[type],
  type,
  tiktokGoListed: true,
  location: { country, state, city },
  accentColor: hues[type],
  rating: Math.round((4.2 + rand() * 0.8) * 10) / 10,
  description: `${name} is a demo ${type.toLowerCase()} partner in ${city}. Replace with partner-provided copy from the TikTok GO / partner API.`,
}));

const themes = {
  Resort: ['Poolside Golden Hour', 'Resort Day Pass Takeover', 'Spa & Wellness Day', 'Family Fun Weekend'],
  Hotel: ['Suite Tour Content Day', 'Rooftop Night Shoot', 'Staycation Weekend', 'Room Reveal Day'],
  Boutique: ['Design Detail Shoot', 'Hidden Gem Getaway', 'Slow Morning Story Day'],
  Tour: ['Guided Tour Content Day', 'Local Flavors Tour', 'Sunset Tour Shoot'],
  Attraction: ['VIP Access Content Day', 'Behind-the-Scenes Shoot', 'Golden Hour Experience'],
  Adventure: ['Adventure Day Takeover', 'Thrill Seeker Shoot', 'Explore & Create Day'],
};
const stayPerks = ['Complimentary 1-night stay', 'Complimentary 2-night stay', '$150 food & beverage credit', 'Spa treatment', 'Welcome cocktail', 'Plus-one included', 'Airport transfer', 'Late checkout'];
const activityPerks = ['Complimentary experience', 'Plus-one included', 'Private guide', 'Hotel pickup & drop-off', 'Photos & drone footage shared', 'Snacks & drinks included', 'Priority skip-the-line access'];
const deliverablePool = ['1 TikTok GO video with booking link', '3 Instagram Stories', '1 Instagram Reel', '1 Snapchat Spotlight', 'Facebook Reel cross-post', 'Raw clips shared with partner'];
const platformIds = ['tiktok', 'instagram', 'snapchat', 'facebook', 'youtube'];
const times = ['9:00 AM', '11:00 AM', '1:00 PM', '3:00 PM', '5:30 PM'];

const start = new Date('2026-11-08T12:00:00Z');
const days = [];
let n = 1;
for (const p of partnerRows) {
  const count = 1 + Math.floor(rand() * 3);
  for (let i = 0; i < count; i++) {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + Math.floor(rand() * 110));
    const spots = pick([4, 6, 8, 10, 12]);
    days.push({
      id: `cd_${String(n++).padStart(3, '0')}`,
      partnerId: p.id,
      title: pick(themes[p.type]),
      date: d.toISOString().slice(0, 10),
      time: pick(times),
      location: { ...p.location },
      platforms: ['tiktok', ...pickSome(platformIds.slice(1), 1, 3)],
      spotsTotal: spots,
      spotsTaken: Math.floor(rand() * spots),
      minFollowers: pick([1000, 2500, 5000, 10000, 25000]),
      commissionRate: pick([5, 6, 8, 10, 12]),
      perks: pickSome(p.category === 'Things to Do' ? activityPerks : stayPerks, 2, 4),
      deliverables: ['1 TikTok GO video with booking link', ...pickSome(deliverablePool.slice(1), 1, 3)],
      status: 'open',
    });
  }
}

const locations = { countries: [] };
for (const [code, name] of [['US', 'United States'], ['MX', 'Mexico']]) {
  const states = {};
  partnerRows.filter((p) => p.location.country === code).forEach((p) => {
    (states[p.location.state] ||= new Set()).add(p.location.city);
  });
  locations.countries.push({
    code,
    name,
    states: Object.keys(states).sort().map((s) => ({ name: s, cities: [...states[s]].sort() })),
  });
}

mkdirSync('data', { recursive: true });
writeFileSync('data/partners.json', JSON.stringify(partnerRows, null, 2));
writeFileSync('data/content-days.json', JSON.stringify(days, null, 2));
writeFileSync('data/locations.json', JSON.stringify(locations, null, 2));
console.log(`partners: ${partnerRows.length}, content days: ${days.length}`);
