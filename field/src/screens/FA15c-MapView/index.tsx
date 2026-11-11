import MatchesScreen from '../FA15b-Matches';

export { MatchesMap, offsetKm, ringsFor } from './MatchesMap';

/**
 * FA15c — Matches · map. The same screen as FA15b with the Map view on: the
 * business in the middle, the 3 candidates at their rough area with 2 rings.
 */
export default function MapViewScreen() {
  return <MatchesScreen initialView="map" />;
}
