// Regenerates the demo JSON in /data. Run: node tools/generate-sample-data.mjs
// All partners are FICTIONAL placeholders for the MVP demo.
// Photos are free Unsplash images (https://unsplash.com/license), hotlinked.
import { writeFileSync, mkdirSync } from 'node:fs';

// [name, group, type, country, state, city, [unsplash photo ids]]
const partners = [
  ['Casa Marea Resort', 'Marea Hospitality', 'Resort', 'MX', 'Quintana Roo', 'Tulum', ['1623718649591-311775a30c43', '1549294413-26f195200c16']],
  ['Hotel Coral Azul', 'Azul Collection', 'Hotel', 'MX', 'Quintana Roo', 'Cancún', ['1582719508461-905c673771fd', '1611892440504-42a792e24d32']],
  ['La Selva Boutique', 'Independent', 'Boutique', 'MX', 'Quintana Roo', 'Playa del Carmen', ['1610641818989-c2051b5e2cfd', '1629140727571-9b5c6f6267b4']],
  ['Pacific Cliffs Cabo', 'Horizon Stays Group', 'Resort', 'MX', 'Baja California Sur', 'Los Cabos', ['1757924382007-7b3228526d09', '1445019980597-93fa8acb246c']],
  ['Villa Sol Vallarta', 'Azul Collection', 'Resort', 'MX', 'Jalisco', 'Puerto Vallarta', ['1584132869994-873f9363a562', '1587870306141-4f19861e6c73']],
  ['Casa Tapatía', 'Independent', 'Boutique', 'MX', 'Jalisco', 'Guadalajara', ['1761828122922-5a839ada5b76', '1759472659432-3232e42d04d2']],
  ['Roma Norte House', 'Urbano Hotels', 'Boutique', 'MX', 'Ciudad de México', 'Mexico City', ['1584132967334-10e028bd69f7', '1618773928121-c32242e63f39']],
  ['Oaxaca Mezcal Trails', 'Independent', 'Tour', 'MX', 'Oaxaca', 'Oaxaca City', ['1648528538533-269fde2f9d07', '1614578042874-43557c183d4f']],
  ['Hacienda Blanca', 'Urbano Hotels', 'Hotel', 'MX', 'Yucatán', 'Mérida', ['1551882547-ff40c63fe5fa', '1578683010236-d716f9a3f461']],
  ['Casa Colonial SMA', 'Independent', 'Boutique', 'MX', 'Guanajuato', 'San Miguel de Allende', ['1793113907901-067c231c89c9', '1575540203949-54ccd7a66d98']],
  ['Surf Shack Sayulita', 'Independent', 'Adventure', 'MX', 'Nayarit', 'Sayulita', ['1632299768491-51d27b80d088', '1548288973-797009d1e14d']],
  ['Cenote Explorers', 'Independent', 'Adventure', 'MX', 'Quintana Roo', 'Tulum', ['1763722682615-60ebd0ee2268', '1546838849-6eb6269ae2db']],
  ['Cabo Sail & Snorkel', 'Independent', 'Tour', 'MX', 'Baja California Sur', 'Los Cabos', ['1526761122248-c31c93f8b2b9', '1658298208155-ab71765747a1']],
  ['Chapultepec Art Walks', 'Independent', 'Attraction', 'MX', 'Ciudad de México', 'Mexico City', ['1739224739514-f8456bb4f709', '1698864606778-936dc77599e7']],
  ['The Sunset Marlowe', 'Horizon Stays Group', 'Hotel', 'US', 'California', 'Los Angeles', ['1746475611952-1b12c680f3bc', '1761971976519-7e27a35c9c49']],
  ['Harborview Inn', 'Coastline Hospitality', 'Hotel', 'US', 'California', 'San Diego', ['1657639753220-8d59b05958d1', '1652532836237-f744649ec8fd']],
  ['Desert Bloom Palms', 'Independent', 'Boutique', 'US', 'California', 'Palm Springs', ['1775152928511-a18ed5197827', '1770306924876-acf5fd638eb6']],
  ['Biscayne Bay Suites', 'Coastline Hospitality', 'Hotel', 'US', 'Florida', 'Miami', ['1657639754447-950d2f314481', '1630587148265-761cbd139043']],
  ['Magic Lakes Resort', 'Horizon Stays Group', 'Resort', 'US', 'Florida', 'Orlando', ['1770306924890-cee53fab5871', '1782890790046-2aefb0b503cb']],
  ['Conch Key Cottages', 'Independent', 'Boutique', 'US', 'Florida', 'Key West', ['1658394182922-fae0590632d6', '1607340696730-3a73c584dc92']],
  ['The Hudson Loft', 'Metro Hotel Co.', 'Hotel', 'US', 'New York', 'New York City', ['1652058812572-fad90a1ee06b', '1618773928121-c32242e63f39']],
  ['Neon Strip Tower', 'Metro Hotel Co.', 'Resort', 'US', 'Nevada', 'Las Vegas', ['1664020361093-79cdc912cfb2', '1575540616469-cc6185554e1c']],
  ['Live Oak Lodge', 'Independent', 'Boutique', 'US', 'Texas', 'Austin', ['1759472659432-3232e42d04d2', '1629140727571-9b5c6f6267b4']],
  ['Riverwalk Grand', 'Lone Star Hospitality', 'Hotel', 'US', 'Texas', 'San Antonio', ['1630587148265-761cbd139043', '1578683010236-d716f9a3f461']],
  ['Honky Tonk House', 'Lone Star Hospitality', 'Hotel', 'US', 'Tennessee', 'Nashville', ['1560110734-f03640ca8eda', '1611892440504-42a792e24d32']],
  ['Bayou Jazz & Swamp Tours', 'Independent', 'Tour', 'US', 'Louisiana', 'New Orleans', ['1525994886773-080587e161c2', '1549965738-e1aaf1168943']],
  ['Aloha Tides', 'Coastline Hospitality', 'Resort', 'US', 'Hawaii', 'Honolulu', ['1746640546116-9bde035148e9', '1623718649591-311775a30c43']],
  ['Saguaro Spa Retreat', 'Horizon Stays Group', 'Resort', 'US', 'Arizona', 'Scottsdale', ['1445019980597-93fa8acb246c', '1775152928511-a18ed5197827']],
  ['Windy City Social', 'Metro Hotel Co.', 'Hotel', 'US', 'Illinois', 'Chicago', ['1782890790046-2aefb0b503cb', '1761971976519-7e27a35c9c49']],
  ['Peachtree Food Crawl', 'Independent', 'Tour', 'US', 'Georgia', 'Atlanta', ['1599974579688-8dbdd335c77f', '1552332386-f8dd00dc2f85']],
  ['Summit Peak Chalet', 'Horizon Stays Group', 'Resort', 'US', 'Colorado', 'Aspen', ['1678384982946-69f649058b68', '1548873903-3c3fe3800582']],
  ['Skyline Helicopter Tours', 'Independent', 'Attraction', 'US', 'Nevada', 'Las Vegas', ['1607525884336-66ccfac7ab56', '1484249326436-4e8628de5c54']],
  ['Everglades Airboat Co.', 'Independent', 'Adventure', 'US', 'Florida', 'Miami', ['1671678075677-eae303b606aa', '1660724281862-bf5c98448250']],
  ['Red Rock Jeep Adventures', 'Independent', 'Adventure', 'US', 'Arizona', 'Scottsdale', ['1467489904517-075c242c2b4f', '1591394262835-d04983289f2e']],
  ['Harbor Lights Cruises', 'Independent', 'Attraction', 'US', 'New York', 'New York City', ['1669652513253-98335d27e82e', '1669652513226-7eb0923077d3']],
];

// Paid "Featured" listing tier — these partners show photos on list views.
// Everyone else shows the plain banner (the spot partners can upgrade into).
const featured = new Set([
  'Casa Marea Resort', 'Pacific Cliffs Cabo', 'Roma Norte House', 'Cenote Explorers', 'Cabo Sail & Snorkel',
  'The Sunset Marlowe', 'Biscayne Bay Suites', 'Neon Strip Tower', 'Aloha Tides', 'Summit Peak Chalet',
  'Skyline Helicopter Tours', 'Red Rock Jeep Adventures',
]);

// Two partner categories; "type" is the sub-type shown on cards.
const categoryOf = { Hotel: 'Hotels & Resorts', Resort: 'Hotels & Resorts', Boutique: 'Hotels & Resorts', Tour: 'Things to Do', Attraction: 'Things to Do', Adventure: 'Things to Do' };
const hues = { Resort: '#ff3b5c', Hotel: '#25f4ee', Boutique: '#b388ff', Tour: '#ffb547', Attraction: '#ff8a3d', Adventure: '#5cff9d' };
const slug = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
const photoUrl = (id) => `https://images.unsplash.com/photo-${id}`;

let seed = 42;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const pickSome = (arr, min, max) => {
  const n = min + Math.floor(rand() * (max - min + 1));
  return [...arr].sort(() => rand() - 0.5).slice(0, n);
};

const partnerRows = partners.map(([name, group, type, country, state, city, photoIds]) => ({
  id: `ptn_${slug(name)}`,
  name,
  group,
  category: categoryOf[type],
  type,
  tiktokGoListed: true,
  listingTier: featured.has(name) ? 'featured' : 'standard',
  photos: photoIds.map(photoUrl),
  location: { country, state, city },
  accentColor: hues[type],
  rating: Math.round((4.2 + rand() * 0.8) * 10) / 10,
  description: `${name} is a demo ${type.toLowerCase()} partner in ${city}. Replace with partner-provided copy from the TikTok GO / partner API.`,
}));

// ---------- Content days ----------
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
// TikTok-only for now (see CONFIG.ENABLED_PLATFORMS).
const deliverablePool = ['1 TikTok GO video with booking link', '1 extra TikTok video', '3 TikTok Stories', 'TikTok LIVE from the property', 'Photo carousel post on TikTok', 'Raw clips shared with partner'];
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
      platforms: ['tiktok'],
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

// ---------- Footage Vault (clips shot by the Covenant team) ----------
const clipTitles = {
  Resort: ['Pool drone flyover', 'Golden hour pool b-roll', 'Cabana walkthrough', 'Spa ambience', 'Sunset bar pour'],
  Hotel: ['Room reveal walkthrough', 'Lobby arrival POV', 'Rooftop city views', 'Check-in to bed POV', 'Night skyline timelapse'],
  Boutique: ['Design details montage', 'Courtyard morning light', 'Room tour in 15 seconds', 'Coffee & balcony b-roll'],
  Tour: ['Guide intro + highlights', 'Tasting close-ups', 'Group walk-through', 'Sunset finale'],
  Attraction: ['Arrival & first look', 'VIP access POV', 'Wide establishing shots', 'Crowd reaction b-roll'],
  Adventure: ['Action POV (GoPro)', 'Drone follow shot', 'Gear-up montage', 'Slow-mo splash & reactions'],
};
const clipTags = ['b-roll', 'drone', 'POV', 'golden hour', 'night', 'voiceover-ready', 'no music', 'people', 'no people'];
const clips = [];
let c = 1;
for (const p of partnerRows) {
  if (rand() < 0.25) continue; // not every partner has been shot yet
  const count = 1 + Math.floor(rand() * 3);
  pickSome(clipTitles[p.type], count, count).forEach((title, i) => {
    const shot = new Date('2026-10-30T12:00:00Z');
    shot.setUTCDate(shot.getUTCDate() - Math.floor(rand() * 150));
    clips.push({
      id: `clip_${String(c++).padStart(3, '0')}`,
      partnerId: p.id,
      title,
      thumbnail: p.photos[i % p.photos.length],
      durationSec: pick([8, 12, 15, 22, 30, 45, 60]),
      orientation: '9:16',
      resolution: pick(['4K', '4K', '1080p']),
      shotOn: shot.toISOString().slice(0, 10),
      shotBy: 'Covenant Creative team',
      location: { ...p.location },
      tags: pickSome(clipTags, 2, 3),
      usage: 'Free to repurpose in TikTok posts that tag the partner and use their TikTok GO booking link.',
      saves: Math.floor(rand() * 240),
    });
  });
}

// ---------- Locations (from partners) ----------
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
writeFileSync('data/vault-clips.json', JSON.stringify(clips, null, 2));
writeFileSync('data/locations.json', JSON.stringify(locations, null, 2));
console.log(`partners: ${partnerRows.length} (${featured.size} featured), content days: ${days.length}, vault clips: ${clips.length}`);
