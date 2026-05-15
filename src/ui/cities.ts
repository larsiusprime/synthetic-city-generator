export interface City {
  name: string;
  country: string;
  lat: number;
  lon: number;
}

export const CITIES: readonly City[] = [
  { name: 'New York', country: 'US', lat: 40.7128, lon: -74.006 },
  { name: 'Los Angeles', country: 'US', lat: 34.0522, lon: -118.2437 },
  { name: 'Chicago', country: 'US', lat: 41.8781, lon: -87.6298 },
  { name: 'Houston', country: 'US', lat: 29.7604, lon: -95.3698 },
  { name: 'Phoenix', country: 'US', lat: 33.4484, lon: -112.074 },
  { name: 'Philadelphia', country: 'US', lat: 39.9526, lon: -75.1652 },
  { name: 'San Antonio', country: 'US', lat: 29.4241, lon: -98.4936 },
  { name: 'San Diego', country: 'US', lat: 32.7157, lon: -117.1611 },
  { name: 'Dallas', country: 'US', lat: 32.7767, lon: -96.797 },
  { name: 'San Jose', country: 'US', lat: 37.3382, lon: -121.8863 },
  { name: 'Austin', country: 'US', lat: 30.2672, lon: -97.7431 },
  { name: 'Jacksonville', country: 'US', lat: 30.3322, lon: -81.6557 },
  { name: 'Fort Worth', country: 'US', lat: 32.7555, lon: -97.3308 },
  { name: 'Columbus', country: 'US', lat: 39.9612, lon: -82.9988 },
  { name: 'Charlotte', country: 'US', lat: 35.2271, lon: -80.8431 },
  { name: 'San Francisco', country: 'US', lat: 37.7749, lon: -122.4194 },
  { name: 'Indianapolis', country: 'US', lat: 39.7684, lon: -86.1581 },
  { name: 'Seattle', country: 'US', lat: 47.6062, lon: -122.3321 },
  { name: 'Denver', country: 'US', lat: 39.7392, lon: -104.9903 },
  { name: 'Washington', country: 'US', lat: 38.9072, lon: -77.0369 },
  { name: 'Boston', country: 'US', lat: 42.3601, lon: -71.0589 },
  { name: 'Nashville', country: 'US', lat: 36.1627, lon: -86.7816 },
  { name: 'Detroit', country: 'US', lat: 42.3314, lon: -83.0458 },
  { name: 'Memphis', country: 'US', lat: 35.1495, lon: -90.049 },
  { name: 'Portland', country: 'US', lat: 45.5152, lon: -122.6784 },
  { name: 'Louisville', country: 'US', lat: 38.2527, lon: -85.7585 },
  { name: 'Baltimore', country: 'US', lat: 39.2904, lon: -76.6122 },
  { name: 'Milwaukee', country: 'US', lat: 43.0389, lon: -87.9065 },
  { name: 'Las Vegas', country: 'US', lat: 36.1699, lon: -115.1398 },
  { name: 'Atlanta', country: 'US', lat: 33.749, lon: -84.388 },
  { name: 'Sacramento', country: 'US', lat: 38.5816, lon: -121.4944 },
  { name: 'Kansas City', country: 'US', lat: 39.0997, lon: -94.5786 },
  { name: 'Omaha', country: 'US', lat: 41.2565, lon: -95.9345 },
  { name: 'Cincinnati', country: 'US', lat: 39.1031, lon: -84.512 },
  { name: 'Cleveland', country: 'US', lat: 41.4993, lon: -81.6944 },
  { name: 'Pittsburgh', country: 'US', lat: 40.4406, lon: -79.9959 },
  { name: 'St. Louis', country: 'US', lat: 38.627, lon: -90.1994 },
  { name: 'Minneapolis', country: 'US', lat: 44.9778, lon: -93.265 },
  { name: 'New Orleans', country: 'US', lat: 29.9511, lon: -90.0715 },
  { name: 'Anchorage', country: 'US', lat: 61.2181, lon: -149.9003 },
  { name: 'Honolulu', country: 'US', lat: 21.3069, lon: -157.8583 },
  { name: 'Salt Lake City', country: 'US', lat: 40.7608, lon: -111.891 },
  { name: 'Tampa', country: 'US', lat: 27.9506, lon: -82.4572 },
  { name: 'Miami', country: 'US', lat: 25.7617, lon: -80.1918 },
  { name: 'Madison', country: 'US', lat: 43.0731, lon: -89.4012 },
  { name: 'Des Moines', country: 'US', lat: 41.5868, lon: -93.625 },
  { name: 'Buffalo', country: 'US', lat: 42.8864, lon: -78.8784 },
  { name: 'Raleigh', country: 'US', lat: 35.7796, lon: -78.6382 },
  { name: 'Lawrence', country: 'US', lat: 38.9717, lon: -95.2353 },
  { name: 'Springfield', country: 'US', lat: 39.7817, lon: -89.6501 },

  { name: 'Tokyo', country: 'JP', lat: 35.6762, lon: 139.6503 },
  { name: 'Delhi', country: 'IN', lat: 28.7041, lon: 77.1025 },
  { name: 'Shanghai', country: 'CN', lat: 31.2304, lon: 121.4737 },
  { name: 'São Paulo', country: 'BR', lat: -23.5505, lon: -46.6333 },
  { name: 'Mexico City', country: 'MX', lat: 19.4326, lon: -99.1332 },
  { name: 'Cairo', country: 'EG', lat: 30.0444, lon: 31.2357 },
  { name: 'Mumbai', country: 'IN', lat: 19.076, lon: 72.8777 },
  { name: 'Beijing', country: 'CN', lat: 39.9042, lon: 116.4074 },
  { name: 'Dhaka', country: 'BD', lat: 23.8103, lon: 90.4125 },
  { name: 'Osaka', country: 'JP', lat: 34.6937, lon: 135.5023 },
  { name: 'Karachi', country: 'PK', lat: 24.8607, lon: 67.0011 },
  { name: 'Buenos Aires', country: 'AR', lat: -34.6037, lon: -58.3816 },
  { name: 'Istanbul', country: 'TR', lat: 41.0082, lon: 28.9784 },
  { name: 'Manila', country: 'PH', lat: 14.5995, lon: 120.9842 },
  { name: 'Lagos', country: 'NG', lat: 6.5244, lon: 3.3792 },
  { name: 'Rio de Janeiro', country: 'BR', lat: -22.9068, lon: -43.1729 },
  { name: 'Moscow', country: 'RU', lat: 55.7558, lon: 37.6173 },
  { name: 'Paris', country: 'FR', lat: 48.8566, lon: 2.3522 },
  { name: 'London', country: 'GB', lat: 51.5074, lon: -0.1278 },
  { name: 'Berlin', country: 'DE', lat: 52.52, lon: 13.405 },
  { name: 'Madrid', country: 'ES', lat: 40.4168, lon: -3.7038 },
  { name: 'Rome', country: 'IT', lat: 41.9028, lon: 12.4964 },
  { name: 'Vienna', country: 'AT', lat: 48.2082, lon: 16.3738 },
  { name: 'Prague', country: 'CZ', lat: 50.0755, lon: 14.4378 },
  { name: 'Budapest', country: 'HU', lat: 47.4979, lon: 19.0402 },
  { name: 'Warsaw', country: 'PL', lat: 52.2297, lon: 21.0122 },
  { name: 'Amsterdam', country: 'NL', lat: 52.3676, lon: 4.9041 },
  { name: 'Stockholm', country: 'SE', lat: 59.3293, lon: 18.0686 },
  { name: 'Oslo', country: 'NO', lat: 59.9139, lon: 10.7522 },
  { name: 'Copenhagen', country: 'DK', lat: 55.6761, lon: 12.5683 },
  { name: 'Helsinki', country: 'FI', lat: 60.1699, lon: 24.9384 },
  { name: 'Dublin', country: 'IE', lat: 53.3498, lon: -6.2603 },
  { name: 'Lisbon', country: 'PT', lat: 38.7223, lon: -9.1393 },
  { name: 'Athens', country: 'GR', lat: 37.9838, lon: 23.7275 },
  { name: 'Bangkok', country: 'TH', lat: 13.7563, lon: 100.5018 },
  { name: 'Singapore', country: 'SG', lat: 1.3521, lon: 103.8198 },
  { name: 'Jakarta', country: 'ID', lat: -6.2088, lon: 106.8456 },
  { name: 'Seoul', country: 'KR', lat: 37.5665, lon: 126.978 },
  { name: 'Hong Kong', country: 'HK', lat: 22.3193, lon: 114.1694 },
  { name: 'Sydney', country: 'AU', lat: -33.8688, lon: 151.2093 },
  { name: 'Melbourne', country: 'AU', lat: -37.8136, lon: 144.9631 },
  { name: 'Auckland', country: 'NZ', lat: -36.8485, lon: 174.7633 },
  { name: 'Toronto', country: 'CA', lat: 43.6532, lon: -79.3832 },
  { name: 'Montreal', country: 'CA', lat: 45.5017, lon: -73.5673 },
  { name: 'Vancouver', country: 'CA', lat: 49.2827, lon: -123.1207 },
  { name: 'Bogotá', country: 'CO', lat: 4.711, lon: -74.0721 },
  { name: 'Lima', country: 'PE', lat: -12.0464, lon: -77.0428 },
  { name: 'Santiago', country: 'CL', lat: -33.4489, lon: -70.6693 },
  { name: 'Nairobi', country: 'KE', lat: -1.2921, lon: 36.8219 },
  { name: 'Cape Town', country: 'ZA', lat: -33.9249, lon: 18.4241 },
];

const lookupMap = new Map<string, City>();
for (const c of CITIES) {
  lookupMap.set(c.name.toLowerCase(), c);
  lookupMap.set(`${c.name.toLowerCase()}, ${c.country.toLowerCase()}`, c);
}

export function findCity(query: string): City | null {
  return lookupMap.get(query.trim().toLowerCase()) ?? null;
}

/** Parses a "lat,lon" or "lat lon" string into LonLat, or null. */
export function parseLatLon(query: string): { lat: number; lon: number } | null {
  const m = query.trim().match(/^(-?\d+(?:\.\d+)?)[ ,]+(-?\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lon = Number(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat, lon };
}
