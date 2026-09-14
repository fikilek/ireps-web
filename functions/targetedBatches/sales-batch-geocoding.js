import { defineSecret } from "firebase-functions/params";
import { composeSalesGeocodingAddress, coordinateNumber, correctedStreetName, GEOCODING_PROVIDER, salesStreetType } from "../salesAllMeters/sales-batch-policy.js";

export const googleGeocodingApiKey = defineSecret("GOOGLE_GEOCODING_API_KEY");
const normalize = value => String(value || "").trim().replace(/\s+/g, " ").toUpperCase();
const routeText = value => normalize(value).replace(/\b(ST|STR)\b/g, "STREET").replace(/\bRD\b/g, "ROAD").replace(/\bDR\b/g, "DRIVE").replace(/\bAVE\b/g, "AVENUE").replace(/\b(CR|CRES)\b/g, "CRESCENT");
const trailingStreetType = /\s+(STREET|ST|STR|ROAD|RD|DRIVE|DR|AVENUE|AVE|AV|LANE|LN|CRESCENT|CRES|CR|PLACE|PL|CLOSE|CL|WAY|WY)\.?$/;
function matchesSalesRoute(route, sales) {
  // TB-R041 (1.3.12): the owner-approved spelling, else the Sales spelling; still exact.
  const street = correctedStreetName(sales);
  const type = salesStreetType(sales), name = routeText(street);
  const actual = routeText(route);
  if (type) return actual === routeText(`${street} ${type}`);
  // Only an unspecified type permits dropping one trailing type word. The
  // complete street name must still match; never use prefix or fuzzy matching.
  return actual === name || actual.replace(trailingStreetType, "") === name;
}
const addressConfigurationError = () => ({ ok: false, code: "GEOCODING_CONFIGURATION_ERROR", incomplete: true });
export function acceptGoogleGeocode(response, sales) {
  const address = composeSalesGeocodingAddress(sales);
  if (!address) return addressConfigurationError();
  if (response?.status === "ZERO_RESULTS") return { ok: false, code: "NO_EXACT_POSITION" };
  if (response?.status !== "OK" || !Array.isArray(response.results)) return { ok: false, code: "GEOCODING_UNAVAILABLE", incomplete: true };
  const accepted = response.results.filter(result => {
    if (result.partial_match || result.geometry?.location_type !== "ROOFTOP") return false;
    const components = Array.isArray(result.address_components) ? result.address_components : [];
    const ofType = type => components.filter(component => component.types?.includes(type));
    const number = ofType("street_number");
    const routes = ofType("route");
    const towns = components.filter(component => component.types?.some(type => ["locality", "postal_town", "sublocality", "administrative_area_level_3"].includes(type)));
    const country = ofType("country");
    return number.length === 1 && normalize(number[0].long_name) === normalize(sales.adr?.strNo) && routes.length === 1 && [routes[0].long_name, routes[0].short_name].some(route => matchesSalesRoute(route, sales)) && towns.some(town => [town.long_name, town.short_name].some(value => normalize(value) === normalize(sales.town))) && country.length === 1 && country[0].short_name === "ZA" && coordinateNumber(result.geometry.location?.lat, 90) !== null && coordinateNumber(result.geometry.location?.lng, 180) !== null;
  });
  const points = new Map(accepted.map(result => {
    const point = { latitude: Number(result.geometry.location.lat), longitude: Number(result.geometry.location.lng) };
    return [JSON.stringify(point), point];
  }));
  if (points.size !== 1) return { ok: false, code: "NO_EXACT_POSITION" };
  return { ok: true, point: [...points.values()][0], provider: GEOCODING_PROVIDER, address, matchLevel: "EXACT_STREET_NUMBER" };
}
// Credentials enter only the authorized handler's adapter. Never log request URLs,
// raw provider errors or responses, which may include key/address material.
export async function geocodeSalesAddress({ sales, apiKey, fetchImpl = fetch }) {
  const address = composeSalesGeocodingAddress(sales);
  if (!address) return addressConfigurationError();
  if (!apiKey) return { ok: false, code: "GEOCODING_UNAVAILABLE", incomplete: true };
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", address);
  url.searchParams.set("components", "country:ZA");
  url.searchParams.set("region", "za");
  url.searchParams.set("key", apiKey);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetchImpl(url.toString(), { signal: AbortSignal.timeout(8000) });
      if (!response.ok) {
        if (attempt === 0 && [429, 500, 502, 503, 504].includes(response.status)) continue;
        return { ok: false, code: "GEOCODING_UNAVAILABLE", incomplete: true };
      }
      const body = await response.text();
      if (body.length > 256000) return { ok: false, code: "GEOCODING_UNAVAILABLE", incomplete: true };
      return acceptGoogleGeocode(JSON.parse(body), sales);
    } catch {
      if (attempt === 1) return { ok: false, code: "GEOCODING_UNAVAILABLE", incomplete: true };
    }
  }
  return { ok: false, code: "GEOCODING_UNAVAILABLE", incomplete: true };
}
