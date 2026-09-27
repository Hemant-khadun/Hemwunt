// Test stub: stations are set directly instead of via ScrollTrigger.
export interface Station {
    index: number;
    progress: number;
    centred: number;
    inView: boolean;
    centreScroll: number;
    measured: boolean;
}
const stations = new Map<number, Station>();
export function setStation(s: Station) { stations.set(s.index, s); }
export function getStation(i: number) { return stations.get(i); }
export function getStations() { return [...stations.values()]; }
export function getActiveStation() { return undefined; }
export function registerStation() { return () => {}; }
