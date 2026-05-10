import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Circle,
  useMap,
} from "react-leaflet";
import MarkerClusterGroup from "react-leaflet-cluster";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Info, Trash2, Layers } from "lucide-react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet.heat";

// ✅ Fix for Leaflet icons in React
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png",
  iconUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png",
  shadowUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png",
});

interface Claim {
  id: number;
  patta_holder_name: string;
  father_or_husband_name?: string;
  village_name: string;
  district: string;
  state: string;
  total_area_claimed: string;
  coordinates: string;
  claim_id: string;
  status: string;
  claim_type?: string;
  land_use?: string;
  cultivation?: string;
  phone?: string;
  [key: string]: any;
}

const BACKEND_URL =
  import.meta.env.VITE_BACKEND_URL || "http://localhost:8000/search";

const parseCoordinates = (value?: string): [number, number] | null => {
  if (!value) return null;
  const matches = value.match(/-?\d+(?:\.\d+)?/g);
  if (!matches || matches.length < 2) return null;

  const lat = Number(matches[0]);
  const lng = Number(matches[1]);
  if (Number.isNaN(lat) || Number.isNaN(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return [lat, lng];
};

const MapAutoFit = ({ claims }: { claims: Claim[] }) => {
  const map = useMap();

  useEffect(() => {
    const points = claims
      .map((claim) => parseCoordinates(claim.coordinates))
      .filter((coords): coords is [number, number] => coords !== null);

    if (points.length === 0) return;
    if (points.length === 1) {
      map.setView(points[0], 11);
      return;
    }

    map.fitBounds(points, { padding: [40, 40] });
  }, [claims, map]);

  return null;
};

// Heatmap Integration
const HeatmapLayer = ({ claims }: { claims: Claim[] }) => {
  const map = useMap();
  useEffect(() => {
    const points = claims
      .map((c) => parseCoordinates(c.coordinates))
      .filter((coords): coords is [number, number] => coords !== null);
    if (!points.length) return;
    const heatArr = points.map((p) => [p[0], p[1], 1] as [number, number, number]);
    const heatLayer = (L as any).heatLayer(heatArr, {
      radius: 25,
      blur: 15,
      maxZoom: 17,
      gradient: { 0.4: "blue", 0.6: "cyan", 0.7: "lime", 0.8: "yellow", 1.0: "red" }
    });
    heatLayer.addTo(map);
    return () => {
      map.removeLayer(heatLayer);
    };
  }, [map, claims]);
  return null;
};

const Atlas = () => {
  const [layers, setLayers] = useState({
    ifr: true,
    cfr: true,
    cr: true,
    extents: true,
    villages: true,
    heat: false,
    clustering: true,
  });

  const [claims, setClaims] = useState<Claim[]>([]);
  const [filteredClaims, setFilteredClaims] = useState<Claim[]>([]);
  const [selectedFeature, setSelectedFeature] = useState<any>(null);

  // Search states
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Claim[]>([]);
  const [loadingSearch, setLoadingSearch] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const debounceRef = useRef<number | null>(null);

  const loadAll = async () => {
    try {
      const res = await fetch(
        `${BACKEND_URL.replace(/\/search$/, "")}/upload/all`
      );
      if (!res.ok) throw new Error(`HTTP error ${res.status}`);
      const data = await res.json();

      const results = Array.isArray(data) ? data : data.results || [];
      setClaims(results);
      setFilteredClaims(results);
    } catch (err) {
      console.error("Error fetching FRA data:", err);
      setClaims([]);
      setFilteredClaims([]);
    }
  };

  useEffect(() => {
    void loadAll();
  }, []);

  const toggleLayer = (layerId: keyof typeof layers) => {
    setLayers((prev) => ({ ...prev, [layerId]: !prev[layerId] }));
  };

  const createCustomIcon = (status: string) => {
    const safeStatus = (status || "").toLowerCase();
    let color = "#6b7280";
    if (safeStatus === "verified") color = "#16a34a";
    else if (safeStatus === "pending") color = "#eab308";
    else if (safeStatus === "approved") color = "#2563eb";
    else if (safeStatus === "rejected") color = "#dc2626";

    return L.divIcon({
      html: `<div style="background-color: ${color}; width: 18px; height: 18px; border-radius: 50%; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.3);"></div>`,
      iconSize: [18, 18],
      className: "custom-marker",
    });
  };

  const getStatusBadge = (status: string) => {
    const safeStatus = (status || "").toLowerCase();
    switch (safeStatus) {
      case "verified":
        return <Badge className="bg-green-600 text-white">Verified</Badge>;
      case "pending":
        return <Badge className="bg-yellow-500 text-white">Pending</Badge>;
      case "approved":
        return <Badge className="bg-blue-600 text-white">Approved</Badge>;
      case "rejected":
        return <Badge className="bg-red-600 text-white">Rejected</Badge>;
      default:
        return <Badge variant="secondary">{status || "Unknown"}</Badge>;
    }
  };

  const buildSearchUrl = (q?: string) => {
    const base = BACKEND_URL.endsWith("/search")
      ? BACKEND_URL
      : `${BACKEND_URL}/search`;
    const params = new URLSearchParams();
    if (q) params.append("q", q);
    return `${base}?${params.toString()}`;
  };

  const doSearch = async (q: string) => {
    if (!q) {
      setSearchResults([]);
      setFilteredClaims(claims);
      setShowDropdown(false);
      return;
    }
    setLoadingSearch(true);
    setShowDropdown(true);
    try {
      const url = buildSearchUrl(q || undefined);
      const res = await fetch(url);
      const data = await res.json();
      const results = Array.isArray(data) ? data : (data.results || []);
      setSearchResults(results);
      setFilteredClaims(results);
    } catch (err) {
      console.error("Search error:", err);
      setSearchResults([]);
      setFilteredClaims(claims);
    } finally {
      setLoadingSearch(false);
    }
  };

  const handleQueryChange = (value: string) => {
    setQuery(value);
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      doSearch(value.trim());
    }, 350);
  };

  const handleViewOnMap = (result: Claim) => {
    setFilteredClaims([result]);
    setSelectedFeature(result);
    setSearchResults([]);
    setShowDropdown(false);
    setQuery("");
  };

  const handleViewAllOnMap = () => {
    if (!searchResults.length) return;
    setFilteredClaims(searchResults);
    setSelectedFeature(null);
    setShowDropdown(false);
    setQuery("");
  };

  const handleResetMap = () => {
    setQuery("");
    setSearchResults([]);
    setFilteredClaims(claims);
    setShowDropdown(false);
  };

  const handleDeleteRecord = async () => {
    if (!selectedFeature?.id || deletingId) return;

    try {
      setDeletingId(selectedFeature.id);
      const res = await fetch(
        `${BACKEND_URL.replace(/\/search$/, "")}/upload/${selectedFeature.id}`,
        { method: "DELETE" }
      );
      if (!res.ok) throw new Error(`HTTP error ${res.status}`);

      setSelectedFeature(null);
      setSearchResults([]);
      setShowDropdown(false);
      await loadAll();
    } catch (err) {
      console.error("Delete error:", err);
    } finally {
      setDeletingId(null);
    }
  };

  // Pre-calculate Village Coverage Zones
  const villageZones = useMemo(() => {
    if (!layers.villages) return [];
    const grouped: Record<string, { lat: number; lng: number; count: number }> = {};
    filteredClaims.forEach(c => {
       const coords = parseCoordinates(c.coordinates);
       if (!coords) return;
       const vName = c.village_name || 'Unknown';
       if (!grouped[vName]) grouped[vName] = { lat: 0, lng: 0, count: 0 };
       grouped[vName].lat += coords[0];
       grouped[vName].lng += coords[1];
       grouped[vName].count += 1;
    });
    return Object.entries(grouped).map(([vName, data]) => ({
      name: vName,
      lat: data.lat / data.count,
      lng: data.lng / data.count,
      radius: Math.min(2000 + data.count * 1000, 15000)
    }));
  }, [filteredClaims, layers.villages]);

  const renderMarkers = () => {
    return filteredClaims.map((claim) => {
      const coords = parseCoordinates(claim.coordinates);
      if (!coords) return null;
      const [lat, lng] = coords;

      const cType = (claim.claim_type || claim.claim_id || "IFR").toUpperCase();
      let typeFlags = { ifr: false, cr: false, cfr: false };
      if (cType.includes("IFR")) typeFlags.ifr = true;
      else if (cType.includes("CFR")) typeFlags.cfr = true;
      else if (cType.includes("CR")) typeFlags.cr = true;
      else typeFlags.ifr = true;

      // Filter layer overrides
      if (typeFlags.ifr && !layers.ifr) return null;
      if (typeFlags.cr && !layers.cr) return null;
      if (typeFlags.cfr && !layers.cfr) return null;

      // Convert Area to real radius
      let radius = 0;
      if (layers.extents) {
         let areaSqm = 0;
         const aStr = (claim.total_area_claimed || "").toLowerCase();
         let areaRaw = parseFloat(aStr);
         if (!isNaN(areaRaw)) {
            if (aStr.includes("hectare")) areaSqm = areaRaw * 10000;
            else if (aStr.includes("acre") || !aStr) areaSqm = areaRaw * 4046.86;
         }
         radius = areaSqm > 0 ? Math.sqrt(areaSqm / Math.PI) : 0;
      }

      return (
        <React.Fragment key={claim.id}>
          {!layers.heat && (
            <Marker
              position={[lat, lng]}
              icon={createCustomIcon(claim.status)}
              eventHandlers={{ click: () => setSelectedFeature(claim) }}
            >
              <Popup>
                <div className="w-64 text-sm">
                  <h4 className="font-semibold">{claim.patta_holder_name}</h4>
                  <p className="text-xs text-gray-500">{claim.claim_id} ({cType})</p>
                  <p className="text-xs text-gray-500">Area: {claim.total_area_claimed}</p>
                  <div className="mt-2">{getStatusBadge(claim.status)}</div>
                </div>
              </Popup>
            </Marker>
          )}

          {layers.extents && radius > 0 && (
             <Circle
               center={[lat, lng]}
               radius={radius}
               pathOptions={{
                 color: (claim.status || "").toLowerCase() === "verified" ? "green" : "blue",
                 fillOpacity: 0.2,
                 weight: 2
               }}
               eventHandlers={{ click: () => setSelectedFeature(claim) }}
             />
          )}
        </React.Fragment>
      );
    });
  };

  return (
    <div className="h-screen flex">
      {/* Sidebar */}
      <div className="w-80 bg-white shadow-xl border-r overflow-y-auto flex flex-col z-10">
        <div className="p-5 flex-1">
          <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 text-transparent bg-clip-text">
            FRA Atlas
          </h1>
          <p className="text-sm text-gray-500 mb-4">
            Interactive WebGIS for Forest Rights Act
          </p>

          {/* Layers & Legend Toggle UI */}
          <div className="mb-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <Layers className="h-4 w-4 text-indigo-600" />
              Layers & Legend
            </h3>
            <div className="flex flex-col gap-2">
              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer hover:text-indigo-600 transition-colors">
                <input type="checkbox" className="accent-indigo-600 w-4 h-4" checked={layers.ifr} onChange={() => toggleLayer('ifr')} />
                <span className="w-3 h-3 rounded-full bg-blue-500 border border-black/10"></span> IFR Markers
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer hover:text-indigo-600 transition-colors">
                <input type="checkbox" className="accent-indigo-600 w-4 h-4" checked={layers.cr} onChange={() => toggleLayer('cr')} />
                <span className="w-3 h-3 rounded-full bg-yellow-500 border border-black/10"></span> CR Markers
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer hover:text-indigo-600 transition-colors">
                <input type="checkbox" className="accent-indigo-600 w-4 h-4" checked={layers.cfr} onChange={() => toggleLayer('cfr')} />
                <span className="w-3 h-3 rounded-full bg-green-600 border border-black/10"></span> CFR Markers
              </label>
              <hr className="my-1 border-gray-200" />
              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer hover:text-indigo-600 transition-colors">
                <input type="checkbox" className="accent-indigo-600 w-4 h-4" checked={layers.extents} onChange={() => toggleLayer('extents')} />
                <div className="w-3 h-3 rounded-full border-2 border-blue-500 bg-blue-500/20"></div>
                Claim Extent Circles
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer hover:text-indigo-600 transition-colors">
                <input type="checkbox" className="accent-indigo-600 w-4 h-4" checked={layers.villages} onChange={() => toggleLayer('villages')} />
                <div className="w-3 h-3 rounded-full border-2 border-purple-500 border-dashed bg-purple-500/10"></div>
                Village Coverage Zones
              </label>
              <hr className="my-1 border-gray-200" />
              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer hover:text-indigo-600 transition-colors">
                <input type="checkbox" className="accent-indigo-600 w-4 h-4" checked={layers.heat} onChange={() => toggleLayer('heat')} />
                <span className="w-4 h-2 rounded bg-gradient-to-r from-blue-500 to-red-500"></span>
                Density Heat Layer
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer hover:text-indigo-600 transition-colors">
                <input type="checkbox" className="accent-indigo-600 w-4 h-4" checked={layers.clustering} onChange={() => toggleLayer('clustering')} />
                Marker Clustering
              </label>
            </div>
          </div>

          {/* Search Box */}
          <div className="relative mb-4">
            <Input
              value={query}
              onChange={(e) => handleQueryChange(e.target.value)}
              placeholder="Search by name, village, claim ID..."
              className="pl-3 rounded-md border-gray-300"
              onFocus={() => {
                if (searchResults.length > 0) setShowDropdown(true);
              }}
            />



            {/* Search Dropdown */}
            {showDropdown && (
              <div className="absolute left-0 right-0 mt-2 bg-white shadow-xl border rounded-md max-h-64 overflow-y-auto z-[9999]">
                {loadingSearch && (
                  <div className="p-3 text-sm text-gray-500">Searching...</div>
                )}

                {!loadingSearch && searchResults.length === 0 && (
                  <div className="p-3 text-sm text-gray-600">
                    No results found. Showing {claims.length} total claims.
                  </div>
                )}

                {!loadingSearch &&
                  searchResults.length > 0 &&
                  searchResults.map((result) => (
                    <div
                      key={result.id}
                      className="p-3 hover:bg-gray-50 border-b flex justify-between items-start cursor-pointer"
                      onClick={() => handleViewOnMap(result)}
                    >
                      <div className="pr-2">
                        <h4 className="font-medium text-sm text-indigo-700">
                          {result.patta_holder_name}
                        </h4>
                        <p className="text-xs text-gray-500">
                          {result.village_name}, {result.district}
                        </p>
                        <p className="text-xs font-mono text-gray-400 mt-1">
                          {result.claim_id}
                        </p>
                        <div className="mt-2">{getStatusBadge(result.status)}</div>
                      </div>
                    </div>
                  ))}

                {searchResults.length > 1 && (
                  <div className="p-2 bg-gray-50 text-right sticky bottom-0 border-t">
                    <button
                      onClick={handleViewAllOnMap}
                      className="text-xs bg-indigo-600 text-white px-3 py-1.5 rounded-md hover:bg-indigo-700 font-medium"
                    >
                      View all on Map
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Selected Feature */}
          {selectedFeature && (
            <Card className="shadow-md border-indigo-100 bg-indigo-50/30">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2 text-indigo-800">
                  <Info className="h-4 w-4" /> Feature Information
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-3">
                <div>
                  <p className="font-semibold text-gray-900 text-base">
                    {selectedFeature.patta_holder_name}
                  </p>
                  <p className="font-mono text-xs text-gray-500">
                    {selectedFeature.claim_id}
                  </p>
                </div>
                
                <div className="grid grid-cols-2 gap-y-2 text-xs">
                  <span className="text-gray-500 font-medium">Village</span>
                  <span className="text-gray-900">{selectedFeature.village_name}</span>
                  <span className="text-gray-500 font-medium">District</span>
                  <span className="text-gray-900">{selectedFeature.district}</span>
                  <span className="text-gray-500 font-medium">State</span>
                  <span className="text-gray-900">{selectedFeature.state}</span>
                  <span className="text-gray-500 font-medium">Area</span>
                  <span className="text-gray-900 font-semibold">{selectedFeature.total_area_claimed}</span>
                </div>
                
                <div className="flex justify-between items-center pt-3 border-t">
                  {getStatusBadge(selectedFeature.status)}
                  <div className="flex gap-2">
                    <button
                      onClick={handleDeleteRecord}
                      disabled={deletingId === selectedFeature.id}
                      className="text-xs bg-red-600 text-white px-3 py-1.5 rounded hover:bg-red-700 disabled:opacity-60 transition"
                    >
                      <Trash2 className="inline h-3 w-3 mr-1" />
                      {deletingId === selectedFeature.id ? "Deleting..." : "Delete"}
                    </button>
                    <button
                      onClick={handleResetMap}
                      className="text-xs bg-gray-200 text-gray-800 px-3 py-1.5 rounded hover:bg-gray-300 transition"
                    >
                      Reset
                    </button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Map */}
      <div className="flex-1 relative z-0">
        <MapContainer
          center={[22.9734, 78.6569]}
          zoom={6}
          style={{ height: "100%", width: "100%" }}
        >
          <TileLayer
            attribution='&copy; <a href="https://osm.org/copyright">OSM</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <MapAutoFit claims={filteredClaims} />
          
          {layers.heat && <HeatmapLayer claims={filteredClaims} />}
          
          {layers.villages && villageZones.map((z, idx) => (
             <Circle 
               key={`vz-${idx}`} 
               center={[z.lat, z.lng]} 
               radius={z.radius} 
               pathOptions={{ color: 'purple', fillColor: 'purple', fillOpacity: 0.1, dashArray: '5, 5', weight: 2 }}
             >
               <Popup>
                 <div className="font-semibold text-purple-800">Village Coverage</div>
                 <div className="font-medium">{z.name}</div>
               </Popup>
             </Circle>
          ))}

          {layers.clustering && !layers.heat ? (
            <MarkerClusterGroup chunkedLoading maxClusterRadius={40}>
              {renderMarkers()}
            </MarkerClusterGroup>
          ) : renderMarkers()}
          
        </MapContainer>
      </div>
    </div>
  );
};

export default Atlas;
