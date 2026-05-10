import React, { useEffect, useMemo, useState } from "react";
import { Circle, MapContainer, Marker, Polygon, Popup, TileLayer, Tooltip, useMap, useMapEvents } from "react-leaflet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Download, Eye, FilePenLine, Filter, Info, Layers3, MapPinned, RefreshCcw, Search, Trash2, ShieldCheck, ShieldAlert, History, Bot, ChevronUp, ChevronDown, Save, CheckCircle2, XCircle } from "lucide-react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { apiFetch } from "@/lib/api";

type ClaimType = "IFR" | "CR" | "CFR";
type MappedFilter = "all" | "mapped" | "unmapped";
type Claim = { id: number; patta_holder_name: string; father_or_husband_name: string; age: string; gender: string; address: string; village_name: string; block: string; district: string; state: string; total_area_claimed: string; coordinates: string; land_use: string; claim_id: string; claim_type: ClaimType; date_of_application: string; water_bodies: string; forest_cover: string; homestead: string; status: string; created_at?: string; geometry_geojson?: any; geometry_status?: string; area_acres?: number | null };
type Filters = { query: string; state: string; district: string; village: string; claimType: string; status: string; mapped: MappedFilter };
type LayersState = { ifr: boolean; cr: boolean; cfr: boolean; extent: boolean; villageZones: boolean; density: boolean; clustering: boolean };
type ClusterGroup = { id: string; lat: number; lng: number; claims: Claim[] };
type VillageGroup = { id: string; village_name: string; district: string; state: string; lat: number; lng: number; count: number };
type Draft = Omit<Claim, "id" | "status" | "created_at">;

const TYPE_META: Record<ClaimType, { color: string; shape: "circle" | "square" | "diamond" }> = { IFR: { color: "#16a34a", shape: "circle" }, CR: { color: "#2563eb", shape: "square" }, CFR: { color: "#7c3aed", shape: "diamond" } };
const STATUS_COLORS: Record<string, string> = { pending: "#f59e0b", verified: "#16a34a", approved: "#2563eb", rejected: "#dc2626" };
const DEFAULT_FILTERS: Filters = { query: "", state: "", district: "", village: "", claimType: "", status: "", mapped: "all" };
const DEFAULT_LAYERS: LayersState = { ifr: true, cr: true, cfr: true, extent: true, villageZones: true, density: false, clustering: true };
const emptyDraft = (c?: Claim | null): Draft => ({ patta_holder_name: c?.patta_holder_name || "", father_or_husband_name: c?.father_or_husband_name || "", age: c?.age || "", gender: c?.gender || "", address: c?.address || "", village_name: c?.village_name || "", block: c?.block || "", district: c?.district || "", state: c?.state || "", total_area_claimed: c?.total_area_claimed || "", coordinates: c?.coordinates || "", land_use: c?.land_use || "", claim_id: c?.claim_id || "", claim_type: c?.claim_type || "IFR", date_of_application: c?.date_of_application || "", water_bodies: c?.water_bodies || "", forest_cover: c?.forest_cover || "", homestead: c?.homestead || "" });
const parseCoords = (v?: string): [number, number] | null => { if (!v) return null; const m = v.match(/-?\d+(?:\.\d+)?/g); if (!m || m.length < 2) return null; const lat = Number(m[0]); const lng = Number(m[1]); return Number.isNaN(lat) || Number.isNaN(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180 ? null : [lat, lng]; };
const parseGeometry = (geometry: any): [number, number][][] | null => {
  const geo = geometry?.geometry || geometry;
  if (!geo?.type || !geo?.coordinates) return null;
  if (geo.type === "Polygon") {
    return geo.coordinates.map((ring: [number, number][]) => ring.map((point) => [point[1], point[0]]));
  }
  if (geo.type === "MultiPolygon") {
    return geo.coordinates[0]?.map((ring: [number, number][]) => ring.map((point) => [point[1], point[0]])) || null;
  }
  return null;
};
const normalize = (r: Record<string, unknown>): Claim => ({ id: Number(r.id || 0), patta_holder_name: String(r.patta_holder_name || ""), father_or_husband_name: String(r.father_or_husband_name || ""), age: String(r.age || ""), gender: String(r.gender || ""), address: String(r.address || ""), village_name: String(r.village_name || ""), block: String(r.block || ""), district: String(r.district || ""), state: String(r.state || ""), total_area_claimed: String(r.total_area_claimed || ""), coordinates: String(r.coordinates || ""), land_use: String(r.land_use || ""), claim_id: String(r.claim_id || ""), claim_type: (["IFR", "CR", "CFR"].includes(String(r.claim_type || "IFR").toUpperCase()) ? String(r.claim_type || "IFR").toUpperCase() : "IFR") as ClaimType, date_of_application: String(r.date_of_application || ""), water_bodies: String(r.water_bodies || ""), forest_cover: String(r.forest_cover || ""), homestead: String(r.homestead || ""), status: String(r.status || "pending").toLowerCase(), created_at: r.created_at ? String(r.created_at) : undefined, geometry_geojson: r.geometry_geojson, geometry_status: r.geometry_status ? String(r.geometry_status) : undefined, area_acres: r.area_acres ? Number(r.area_acres) : null });
const badge = (s: string) => s === "verified" ? <Badge className="bg-green-600 text-white">Verified</Badge> : s === "approved" ? <Badge className="bg-blue-600 text-white">Approved</Badge> : s === "rejected" ? <Badge className="bg-red-600 text-white">Rejected</Badge> : <Badge className="bg-amber-500 text-white">Pending</Badge>;
const areaRadius = (v: string) => { const n = Number.parseFloat(v); if (Number.isNaN(n) || n <= 0) return null; const t = v.toLowerCase(); const sqm = t.includes("hect") ? n * 10000 : t.includes("acre") ? n * 4046.86 : t.includes("sq") ? n : n * 4046.86; return Math.max(40, Math.sqrt(sqm / Math.PI)); };
const clusterSize = (z: number) => z <= 5 ? 0.7 : z <= 7 ? 0.35 : z <= 9 ? 0.16 : 0.08;
const villageGroups = (claims: Claim[]): VillageGroup[] => { const map = new Map<string, Claim[]>(); claims.forEach((c) => { if (!parseCoords(c.coordinates) || !c.village_name) return; const k = `${c.village_name}|${c.district}|${c.state}`; map.set(k, [...(map.get(k) || []), c]); }); return Array.from(map.entries()).map(([id, bucket]) => { const sum = bucket.reduce((a, c) => { const d = parseCoords(c.coordinates)!; return { lat: a.lat + d[0], lng: a.lng + d[1] }; }, { lat: 0, lng: 0 }); return { id, village_name: bucket[0].village_name, district: bucket[0].district, state: bucket[0].state, lat: sum.lat / bucket.length, lng: sum.lng / bucket.length, count: bucket.length }; }); };
const clusters = (claims: Claim[], zoom: number): ClusterGroup[] => { const size = clusterSize(zoom); const map = new Map<string, Claim[]>(); claims.forEach((c) => { const d = parseCoords(c.coordinates); if (!d) return; const k = `${Math.floor(d[0] / size)}:${Math.floor(d[1] / size)}`; map.set(k, [...(map.get(k) || []), c]); }); return Array.from(map.entries()).map(([id, bucket]) => { const sum = bucket.reduce((a, c) => { const d = parseCoords(c.coordinates)!; return { lat: a.lat + d[0], lng: a.lng + d[1] }; }, { lat: 0, lng: 0 }); return { id, lat: sum.lat / bucket.length, lng: sum.lng / bucket.length, claims: bucket }; }); };
const claimIcon = (claim: Claim, selected: boolean, dim: boolean) => { const meta = TYPE_META[claim.claim_type]; const border = STATUS_COLORS[claim.status] || "#6b7280"; const shape = meta.shape === "circle" ? "border-radius:999px;" : meta.shape === "square" ? "border-radius:6px;" : "border-radius:4px;transform:rotate(45deg);"; return L.divIcon({ className: "fra-claim-marker", html: `<div style="position:relative;width:26px;height:26px;opacity:${dim ? 0.35 : 1};">${selected ? `<div style="position:absolute;inset:-5px;border:3px solid ${border};border-radius:999px;"></div>` : ""}<div style="position:absolute;inset:4px;background:${meta.color};border:3px solid ${border};${shape}"></div></div>`, iconSize: [26, 26], iconAnchor: [13, 13] }); };
const clusterIcon = (count: number) => L.divIcon({ className: "fra-cluster-marker", html: `<div style="width:38px;height:38px;border-radius:999px;background:rgba(37,99,235,0.9);border:3px solid white;display:flex;align-items:center;justify-content:center;color:white;font-weight:700;box-shadow:0 8px 24px rgba(15,23,42,0.22);">${count}</div>`, iconSize: [38, 38], iconAnchor: [19, 19] });
const MapBridge = ({ onZoom }: { onZoom: (z: number) => void }) => { useMapEvents({ zoomend(e) { onZoom(e.target.getZoom()); } }); return null; };
const Fit = ({ claims, selected, resetKey }: { claims: Claim[]; selected: Claim | null; resetKey: number }) => { const map = useMap(); useEffect(() => { if (selected) { const d = parseCoords(selected.coordinates); if (d) map.flyTo(d, Math.max(map.getZoom(), 11), { duration: 0.8 }); return; } const pts = claims.map((c) => parseCoords(c.coordinates)).filter((d): d is [number, number] => d !== null); if (!pts.length) return; if (pts.length === 1) { map.setView(pts[0], 11); return; } map.fitBounds(pts, { padding: [36, 36] }); }, [claims, map, resetKey, selected]); return null; };
const ClusterMarker = ({ cluster, onOpen }: { cluster: ClusterGroup; onOpen: (c: Claim) => void }) => { const map = useMap(); return <Marker position={[cluster.lat, cluster.lng]} icon={clusterIcon(cluster.claims.length)} eventHandlers={{ click: () => { map.flyTo([cluster.lat, cluster.lng], Math.min(map.getZoom() + 2, 12), { duration: 0.8 }); onOpen(cluster.claims[0]); } }}><Popup><div className="w-56 space-y-2 text-sm"><p className="font-semibold">{cluster.claims.length} claims in this area</p><p className="text-slate-500">Zoom in to inspect individual claims.</p>{cluster.claims.slice(0, 4).map((c) => <div key={c.id} className="rounded bg-slate-50 px-2 py-1"><p className="font-medium">{c.patta_holder_name || "Unnamed claim"}</p><p className="text-xs text-slate-500">{c.claim_id || "No claim ID"}</p></div>)}</div></Popup></Marker>; };
const popup = (claim: Claim) => <Popup><div className="w-72 space-y-2 text-sm"><div className="flex items-start justify-between gap-3"><div><p className="font-semibold text-slate-950">{claim.patta_holder_name || "Unnamed claim"}</p><p className="font-mono text-xs text-slate-500">{claim.claim_id || "No claim ID"}</p></div>{badge(claim.status)}</div><div className="grid grid-cols-2 gap-x-3 gap-y-1"><span className="text-slate-500">Claim Type</span><span>{claim.claim_type}</span><span className="text-slate-500">Village</span><span>{claim.village_name || "-"}</span><span className="text-slate-500">District</span><span>{claim.district || "-"}</span><span className="text-slate-500">State</span><span>{claim.state || "-"}</span><span className="text-slate-500">Area</span><span>{claim.total_area_claimed || "-"}</span><span className="text-slate-500">Land Use</span><span>{claim.land_use || "-"}</span><span className="text-slate-500">Application</span><span>{claim.date_of_application || "-"}</span></div></div></Popup>;
const AtlasEnhanced = () => {
  const [claims, setClaims] = useState<Claim[]>([]); const [searchInput, setSearchInput] = useState(""); const [loading, setLoading] = useState(true); const [error, setError] = useState<string | null>(null); const [layers, setLayers] = useState<LayersState>(DEFAULT_LAYERS); const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS); const [zoom, setZoom] = useState(6); const [selectedId, setSelectedId] = useState<number | null>(null); const [draft, setDraft] = useState<Draft>(emptyDraft()); const [editing, setEditing] = useState(false); const [savingId, setSavingId] = useState<number | null>(null); const [deletingId, setDeletingId] = useState<number | null>(null); const [rerunId, setRerunId] = useState<number | null>(null); const [resetKey, setResetKey] = useState(0); const [chainStatus, setChainStatus] = useState<any>(null); const [auditLogs, setAuditLogs] = useState<any[] | null>(null); const [loadingAudit, setLoadingAudit] = useState(false); const [assetData, setAssetData] = useState<any | null>(null); const [loadingAsset, setLoadingAsset] = useState(false); const [showAssetModal, setShowAssetModal] = useState(false); const [tableCollapsed, setTableCollapsed] = useState(false); const [showLegend, setShowLegend] = useState(true);
  const loadAll = async () => { try { setLoading(true); setError(null); const data = await apiFetch(`/upload/all?page=1&page_size=500`); const results = Array.isArray(data.data) ? data.data : []; setClaims(results.map((r: Record<string, unknown>) => normalize(r))); } catch (err) { console.error("Atlas load error:", err); setClaims([]); setError("Could not load Atlas records."); } finally { setLoading(false); } };
  useEffect(() => { void loadAll(); }, []);
  const selected = useMemo(() => claims.find((c) => c.id === selectedId) || null, [claims, selectedId]);
  useEffect(() => { setDraft(emptyDraft(selected)); setEditing(false); }, [selected]);
  const options = useMemo(() => ({ states: Array.from(new Set(claims.map((c) => c.state).filter(Boolean))).sort(), districts: Array.from(new Set(claims.filter((c) => !filters.state || c.state === filters.state).map((c) => c.district).filter(Boolean))).sort(), villages: Array.from(new Set(claims.filter((c) => (!filters.state || c.state === filters.state) && (!filters.district || c.district === filters.district)).map((c) => c.village_name).filter(Boolean))).sort() }), [claims, filters.state, filters.district]);
  const filtered = useMemo(() => { const q = filters.query.trim().toLowerCase(); return claims.filter((c) => { const mapped = Boolean(parseCoords(c.coordinates)); const matchesQuery = !q || [c.patta_holder_name, c.claim_id, c.village_name, c.district, c.state, c.land_use].join(" ").toLowerCase().includes(q); const matchesMapped = filters.mapped === "all" || (filters.mapped === "mapped" && mapped) || (filters.mapped === "unmapped" && !mapped); const matchesLayer = (c.claim_type === "IFR" && layers.ifr) || (c.claim_type === "CR" && layers.cr) || (c.claim_type === "CFR" && layers.cfr); return matchesQuery && (!filters.state || c.state === filters.state) && (!filters.district || c.district === filters.district) && (!filters.village || c.village_name === filters.village) && (!filters.claimType || c.claim_type === filters.claimType) && (!filters.status || c.status === filters.status) && matchesMapped && matchesLayer; }); }, [claims, filters, layers]);
  const matchedIds = useMemo(() => filters.query.trim() ? new Set(filtered.map((c) => c.id)) : new Set<number>(), [filtered, filters.query]);
  const mapped = useMemo(() => filtered.filter((c) => parseCoords(c.coordinates)), [filtered]);
  const unmapped = useMemo(() => filtered.filter((c) => !parseCoords(c.coordinates)), [filtered]);
  const grouped = useMemo(() => villageGroups(mapped), [mapped]);
  const groupedClusters = useMemo(() => layers.clustering && zoom < 10 ? clusters(mapped, zoom) : [], [layers.clustering, mapped, zoom]);
  const analytics = useMemo(() => ({ total: filtered.length, mapped: mapped.length, unmapped: unmapped.length, pending: filtered.filter((c) => c.status === "pending").length, verified: filtered.filter((c) => c.status === "verified" || c.status === "approved").length, states: new Set(filtered.map((c) => c.state).filter(Boolean)).size, districts: new Set(filtered.map((c) => c.district).filter(Boolean)).size }), [filtered, mapped.length, unmapped.length]);
  const reset = () => { setFilters(DEFAULT_FILTERS); setSearchInput(""); setSelectedId(null); setResetKey((v) => v + 1); };
  const executeSearch = () => { setFilters((p) => ({ ...p, query: searchInput })); };
  const exportCsv = () => { const cols = ["id", "claim_id", "patta_holder_name", "claim_type", "village_name", "district", "state", "status", "coordinates", "total_area_claimed", "land_use", "date_of_application"]; const rows = filtered.map((c) => cols.map((f) => `"${String(c[f as keyof Claim] || "").replace(/"/g, '""')}"`).join(",")); const blob = new Blob([[cols.join(","), ...rows].join("\n")], { type: "text/csv;charset=utf-8;" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = "atlas-visible-claims.csv"; a.click(); URL.revokeObjectURL(url); };
  const exportGeoJson = () => { const features = mapped.map((c) => { const d = parseCoords(c.coordinates); const geometry = c.geometry_geojson?.geometry || c.geometry_geojson || (d ? { type: "Point", coordinates: [d[1], d[0]] } : null); return geometry ? { type: "Feature", geometry, properties: c } : null; }).filter(Boolean); const blob = new Blob([JSON.stringify({ type: "FeatureCollection", features }, null, 2)], { type: "application/geo+json" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = "atlas-visible-claims.geojson"; a.click(); URL.revokeObjectURL(url); };
  const saveChanges = async () => { if (!selected) return; try { setSavingId(selected.id); await apiFetch(`/upload/${selected.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft) }); await loadAll(); setEditing(false); } catch (err) { console.error("Update error:", err); setError(err instanceof Error ? err.message : "Could not update record."); } finally { setSavingId(null); } };
  const rerunCoords = async () => { if (!selected) return; try { setRerunId(selected.id); const data = await apiFetch(`/upload/preview`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...draft, coordinates: "" }) }); setDraft(emptyDraft(normalize({ ...selected, ...data.data }))); } catch (err) { console.error("Coordinate rerun error:", err); setError(err instanceof Error ? err.message : "Could not regenerate coordinates."); } finally { setRerunId(null); } };
  const deleteRecord = async () => { if (!selected) return; try { setDeletingId(selected.id); await apiFetch(`/upload/${selected.id}`, { method: "DELETE" }); setSelectedId(null); await loadAll(); } catch (err) { console.error("Delete error:", err); setError("Could not delete record."); } finally { setDeletingId(null); } };
  const verifyIntegrity = async () => { try { setChainStatus({ status: "loading", message: "Verifying blockchain integrity..." }); const data = await apiFetch(`/upload/verify-chain`); setChainStatus({ status: data.status, message: data.message, ...(data.data || {}) }); } catch (err) { setChainStatus({ status: "error", message: "Failed to connect to verification server." }); } };
  const viewAuditHistory = async () => { if (!selected) return; try { setLoadingAudit(true); setAuditLogs([]); const data = await apiFetch(`/upload/${selected.id}/audit-history`); setAuditLogs(data.data || []); } catch (err) { console.error(err); setAuditLogs(null); } finally { setLoadingAudit(false); } };
  const viewAssetIntelligence = async () => { if (!selected) return; try { setLoadingAsset(true); setShowAssetModal(true); const data = await apiFetch(`/upload/${selected.id}/assets?refresh=true`); setAssetData(data.data || { error: data.message }); } catch (err) { console.error(err); setAssetData({ error: "Failed to fetch asset data." }); } finally { setLoadingAsset(false); } };
  return (
    <div className="flex h-full w-full overflow-hidden bg-slate-100">
      <aside className="w-[340px] shrink-0 flex flex-col min-h-0 border-r border-slate-200 bg-white shadow-xl z-20 overflow-y-auto">
        <div className="p-4 space-y-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">FRA Atlas</h1>
            <p className="text-xs text-slate-500 mt-1">Live geographic registry of claims.</p>
          </div>

          <Card className="rounded-xl border-slate-200 shadow-sm">
            <CardHeader className="pb-2 pt-3 px-3">
              <CardTitle className="text-sm flex items-center gap-2"><Search className="h-4 w-4" /> Search</CardTitle>
            </CardHeader>
            <CardContent className="px-3 pb-3 space-y-3 shrink-0">
              <div className="flex gap-2">
                <Input
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && executeSearch()}
                  className="h-8 text-xs placeholder:text-slate-400"
                  placeholder="ID, Applicant, Village..."
                />
                <Button onClick={executeSearch} size="sm" className="h-8 px-3 bg-slate-900 hover:bg-slate-800 text-white"><Search className="h-4 w-4" /></Button>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="flex-1 h-8 text-xs border-slate-200 text-slate-600 hover:bg-slate-50" onClick={reset}><RefreshCcw className="mr-1 h-3 w-3" />Reset</Button>
                <Button variant="outline" size="sm" className="flex-1 h-8 text-xs border-slate-200 text-slate-600 hover:bg-slate-50" onClick={() => setResetKey((v) => v + 1)}><MapPinned className="mr-1 h-3 w-3" />Focus Map</Button>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-xl border-slate-200 shadow-sm">
            <CardHeader className="pb-2 pt-3 px-3 flex flex-row items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2"><ShieldCheck className="h-4 w-4" /> Data Integrity</CardTitle>
            </CardHeader>
            <CardContent className="px-3 pb-3">
              <div className="flex items-center justify-between bg-slate-50 p-2 rounded-lg border border-slate-100 mb-2">
                <div className="flex items-center gap-2 max-w-[180px]">
                  {chainStatus?.status === 'safe' ? <ShieldCheck className="h-5 w-5 text-emerald-500 shrink-0" /> : chainStatus?.status === 'error' ? <ShieldAlert className="h-5 w-5 text-red-500 shrink-0" /> : <ShieldCheck className="h-5 w-5 text-slate-300 shrink-0" />}
                  <span className="text-xs font-semibold text-slate-700 truncate" title={chainStatus?.message}>
                    {chainStatus?.status === 'safe' ? 'Verified' : chainStatus?.status === 'error' ? 'Tampered!' : 'Not Checked'}
                  </span>
                </div>
                <Button size="sm" variant="outline" className="h-7 text-[10px] px-2 shadow-sm shrink-0" onClick={verifyIntegrity}>Verify</Button>
              </div>
              {chainStatus?.status === 'error' && <p className="text-[10px] text-red-600 leading-tight">Tampering detected. Check integrity logs.</p>}
            </CardContent>
          </Card>

          <Card className="rounded-xl border-slate-200 shadow-sm">
            <CardHeader className="pb-2 pt-3 px-3">
              <CardTitle className="text-sm flex items-center gap-2"><Layers3 className="h-4 w-4" /> Visual Modes</CardTitle>
            </CardHeader>
            <CardContent className="px-3 pb-3 space-y-2">
              <LayerToggle label="Show Claims (Extent)" checked={layers.extent} onChange={() => setLayers((p) => ({ ...p, extent: !p.extent }))} />
              <LayerToggle label="Group Close Marks" checked={layers.clustering} onChange={() => setLayers((p) => ({ ...p, clustering: !p.clustering }))} />
            </CardContent>
          </Card>

          <Card className="rounded-xl border-slate-200 bg-indigo-50/50 border-indigo-100 shadow-sm">
            <CardHeader className="pb-2 pt-3 px-3">
              <CardTitle className="text-sm flex items-center gap-2 text-indigo-900"><Info className="h-4 w-4 text-indigo-500" /> Inspection Panel</CardTitle>
            </CardHeader>
            <CardContent className="px-3 pb-3">
              {!selected ? (
                <div className="text-center py-6 px-4">
                  <p className="text-xs text-indigo-400 font-medium italic">Click a map pointer or a table row to inspect.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="font-bold text-slate-900 text-sm leading-tight">{selected.patta_holder_name || "Unknown"}</p>
                      <p className="font-mono text-[10px] text-slate-500 mt-0.5 font-semibold tracking-wider">ID: {selected.claim_id}</p>
                    </div>
                    {badge(selected.status)}
                  </div>

                  {!editing ? (
                    <div className="grid grid-cols-2 gap-x-2 gap-y-1.5 text-[11px] bg-white p-2 rounded border border-indigo-100/50">
                      <span className="text-slate-500">Village:</span><span className="font-medium text-slate-900 truncate" title={selected.village_name}>{selected.village_name || "-"}</span>
                      <span className="text-slate-500">District:</span><span className="font-medium text-slate-900 truncate">{selected.district || "-"}</span>
                      <span className="text-slate-500">Type:</span><span className="font-medium text-slate-900">{selected.claim_type}</span>
                      <span className="text-slate-500">Area:</span><span className="font-medium text-slate-900 truncate">{selected.total_area_claimed || "-"}</span>
                      <span className="text-slate-500">Land Use:</span><span className="font-medium text-slate-900 truncate">{selected.land_use || "-"}</span>
                      <span className="text-slate-500">Mapped:</span><span className="font-medium text-slate-900">{parseCoords(selected.coordinates) ? "Yes" : "No"}</span>
                    </div>
                  ) : (
                    <div className="space-y-2 bg-white p-2 rounded border border-indigo-200">
                      <p className="text-[10px] font-bold text-indigo-600 uppercase tracking-widest mb-2">Editing Record</p>
                      <EditField label="Applicant Name" value={draft.patta_holder_name} onChange={(v) => setDraft((p) => ({ ...p, patta_holder_name: v }))} />
                      <EditField label="Claim ID" value={draft.claim_id} onChange={(v) => setDraft((p) => ({ ...p, claim_id: v }))} />
                      <EditField label="Village" value={draft.village_name} onChange={(v) => setDraft((p) => ({ ...p, village_name: v }))} />
                      <EditField label="District" value={draft.district} onChange={(v) => setDraft((p) => ({ ...p, district: v }))} />
                      <EditField label="State" value={draft.state} onChange={(v) => setDraft((p) => ({ ...p, state: v }))} />
                      <EditField label="Area Claimed" value={draft.total_area_claimed} onChange={(v) => setDraft((p) => ({ ...p, total_area_claimed: v }))} />
                      <EditField label="Land Use" value={draft.land_use} onChange={(v) => setDraft((p) => ({ ...p, land_use: v }))} />
                      <EditField label="Coordinates" value={draft.coordinates} onChange={(v) => setDraft((p) => ({ ...p, coordinates: v }))} />
                      <SelectField label="Claim Type" value={draft.claim_type} options={["IFR", "CR", "CFR"]} onChange={(v) => setDraft((p) => ({ ...p, claim_type: v as "IFR" | "CR" | "CFR" }))} />
                      <div className="flex gap-2 pt-2">
                        <Button size="sm" className="flex-1 h-8 text-[11px] bg-emerald-600 hover:bg-emerald-700" onClick={() => void saveChanges()} disabled={savingId === selected.id}>
                          <Save className="mr-1 h-3.5 w-3.5" />{savingId === selected.id ? "Saving..." : "Save"}
                        </Button>
                        <Button size="sm" variant="outline" className="flex-1 h-8 text-[11px]" onClick={() => setEditing(false)}>Cancel</Button>
                      </div>
                    </div>
                  )}

                  <div className="flex flex-col gap-2 pt-1">
                    <div className="grid grid-cols-3 gap-1.5">
                      <Button variant="outline" size="sm" className="h-8 text-[11px] bg-white hover:bg-slate-50 px-1" onClick={() => setEditing((p) => !p)}>
                        <FilePenLine className="mr-1 h-3.5 w-3.5 text-indigo-500" />{editing ? "Close" : "Edit"}
                      </Button>
                      <Button variant="outline" size="sm" className="h-8 text-[11px] bg-white hover:bg-slate-50 px-1" onClick={viewAuditHistory}>
                        <History className="mr-1 h-3.5 w-3.5 text-slate-500" />History
                      </Button>
                      <Button variant="outline" size="sm" className="h-8 text-[11px] bg-white hover:bg-red-50 hover:border-red-200 px-1" onClick={() => void deleteRecord()} disabled={deletingId === selected.id}>
                        <Trash2 className="mr-1 h-3.5 w-3.5 text-red-500" />{deletingId === selected.id ? "..." : "Delete"}
                      </Button>
                    </div>
                    <Button size="sm" className="w-full text-xs bg-indigo-600 hover:bg-indigo-700 shadow-md shadow-indigo-600/20" onClick={viewAssetIntelligence}>
                      <Bot className="mr-1.5 h-4 w-4" /> Satellite Land-Cover Scan
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </aside>

      <main className="relative flex-1 flex flex-col z-0 min-h-0 min-w-0">
        <div className="flex-1 relative z-0 min-h-0 overflow-hidden">
          <MapContainer
            center={[22.9734, 78.6569]}
            zoom={zoom}
            style={{ height: "100%", width: "100%" }}
            zoomControl={false}
          >
            <TileLayer
              attribution='&copy; <a href="https://osm.org/copyright">OSM</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <MapBridge onZoom={setZoom} />
            <Fit claims={filtered} selected={selected} resetKey={resetKey} />

            {layers.villageZones && grouped.map((g) => (
              <Circle
                key={g.id}
                center={[g.lat, g.lng]}
                radius={areaRadius(String(g.count * 100)) || 5000}
                pathOptions={{ color: 'purple', fillColor: 'purple', fillOpacity: 0.05, dashArray: '5, 5', weight: 1 }}
              >
                <Tooltip permanent direction="top" opacity={0.7}>
                  <span className="font-bold">{g.village_name}</span> ({g.count})
                </Tooltip>
              </Circle>
            ))}

            {layers.extent && mapped.map((c) => {
              const polygon = parseGeometry(c.geometry_geojson);
              if (polygon) {
                return <Polygon key={`poly-${c.id}`} positions={polygon} pathOptions={{ color: STATUS_COLORS[c.status] || '#ccc', weight: 2, fillOpacity: 0.12 }} />;
              }
              const d = parseCoords(c.coordinates);
              const r = areaRadius(c.total_area_claimed);
              if (!d || !r) return null;
              return <Circle key={`ext-${c.id}`} center={d} radius={r} pathOptions={{ color: STATUS_COLORS[c.status] || '#ccc', weight: 1, fillOpacity: 0.1 }} />;
            })}

            {groupedClusters.length > 0 ? (
              groupedClusters.map((gc) => <ClusterMarker key={gc.id} cluster={gc} onOpen={(c) => setSelectedId(c.id)} />)
            ) : (
              mapped.map((c) => {
                const d = parseCoords(c.coordinates);
                return d ? (
                  <Marker
                    key={c.id}
                    position={d}
                    icon={claimIcon(c, c.id === selectedId, selectedId !== null && c.id !== selectedId)}
                    eventHandlers={{ click: () => setSelectedId(c.id) }}
                  >
                    {popup(c)}
                  </Marker>
                ) : null;
              })
            )}
          </MapContainer>

          <div className="absolute top-4 right-4 z-[400] flex flex-col items-end gap-2">
            <button
              onClick={() => setShowLegend((v) => !v)}
              className="flex items-center gap-1.5 bg-white/95 backdrop-blur-sm border border-slate-200/70 shadow-md rounded-lg px-3 py-1.5 text-[11px] font-semibold text-slate-600 hover:bg-white hover:text-slate-900 transition-colors"
            >
              <Layers3 className="h-3.5 w-3.5" />
              {showLegend ? 'Hide Legend' : 'Show Legend'}
            </button>

            {showLegend && (
              <div className="bg-white/95 backdrop-blur-sm p-4 rounded-xl shadow-lg border border-slate-200/50 min-w-[180px] pointer-events-none">
                <p className="text-[10px] font-bold tracking-[0.1em] text-slate-500 uppercase mb-3 border-b border-slate-200/50 pb-2">Map Legend</p>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-[10px] text-slate-400 font-medium mb-1.5 uppercase">Type</p>
                    <LegendItem label="IFR" color={TYPE_META.IFR.color} shape="circle" />
                    <LegendItem label="CR" color={TYPE_META.CR.color} shape="square" />
                    <LegendItem label="CFR" color={TYPE_META.CFR.color} shape="diamond" />
                  </div>
                  <div>
                    <p className="text-[10px] text-slate-400 font-medium mb-1.5 uppercase">Status</p>
                    <StatusLegend label="Verified" color={STATUS_COLORS.verified} />
                    <StatusLegend label="Approved" color={STATUS_COLORS.approved} />
                    <StatusLegend label="Pending" color={STATUS_COLORS.pending} />
                    <StatusLegend label="Rejected" color={STATUS_COLORS.rejected} />
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="absolute bottom-4 left-4 z-[400] flex gap-2 pointer-events-none">
            <AnalyticsItem label="Visible Map Items" value={analytics.mapped} />
          </div>
        </div>

        <div className={`bg-white border-t border-slate-200 shadow-[0_-5px_15px_-5px_rgba(0,0,0,0.1)] flex flex-col z-10 shrink-0 transition-all duration-300 ${tableCollapsed ? 'h-[38px]' : 'h-[250px]'}`}>
          <div className="px-4 py-2 bg-slate-50 border-b border-slate-200 flex justify-between items-center shrink-0">
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold text-slate-800">Records</span>
              {!tableCollapsed && <Badge variant="secondary" className="text-[10px] font-mono shadow-sm bg-white">{filtered.length} results</Badge>}
            </div>
            <div className="flex gap-2 items-center">
              {!tableCollapsed && <Button variant="outline" size="sm" className="h-7 text-xs shadow-sm bg-white" onClick={exportCsv}><Download className="h-3 w-3 mr-1" />CSV</Button>}
              <button
                onClick={() => setTableCollapsed((v) => !v)}
                className={`h-7 text-[11px] font-semibold px-3 flex items-center gap-1.5 rounded-md border shadow-sm transition-colors ${tableCollapsed ? 'bg-slate-800 text-white hover:bg-slate-700 border-slate-700' : 'bg-white text-slate-600 hover:bg-slate-100 border-slate-200'}`}
              >
                {tableCollapsed ? <><ChevronDown className="h-3.5 w-3.5" /> Show Table</> : <><ChevronUp className="h-3.5 w-3.5" /> Expand Map</>}
              </button>
            </div>
          </div>

          {!tableCollapsed && (
            <div className="flex-1 overflow-auto bg-white">
              <Table className="text-xs">
                <TableHeader className="bg-white sticky top-0 shadow-sm z-10 hover:bg-white">
                  <TableRow className="hover:bg-transparent border-b-slate-200">
                    <TableHead className="w-[100px] font-semibold text-slate-500 py-2 h-auto">Claim ID</TableHead>
                    <TableHead className="font-semibold text-slate-500 py-2 h-auto">Applicant</TableHead>
                    <TableHead className="font-semibold text-slate-500 py-2 h-auto">Type</TableHead>
                    <TableHead className="font-semibold text-slate-500 py-2 h-auto">Village</TableHead>
                    <TableHead className="font-semibold text-slate-500 py-2 h-auto">District</TableHead>
                    <TableHead className="font-semibold text-slate-500 py-2 h-auto text-right">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.slice(0, 100).map(c => (
                    <TableRow
                      key={c.id}
                      className={`cursor-pointer transition-colors border-b-slate-100 ${selectedId === c.id ? 'bg-indigo-50 hover:bg-indigo-100' : 'hover:bg-slate-50'}`}
                      onClick={() => setSelectedId(c.id)}
                    >
                      <TableCell className="font-mono text-slate-500 py-1.5"><div className="truncate w-20" title={c.claim_id}>{c.claim_id}</div></TableCell>
                      <TableCell className="font-medium text-slate-900 py-1.5"><div className="truncate w-32" title={c.patta_holder_name}>{c.patta_holder_name || "Unknown"}</div></TableCell>
                      <TableCell className="py-1.5 font-medium text-[10px] text-slate-500 uppercase">{c.claim_type}</TableCell>
                      <TableCell className="text-slate-600 py-1.5"><div className="truncate w-24" title={c.village_name}>{c.village_name}</div></TableCell>
                      <TableCell className="text-slate-600 py-1.5">{c.district}</TableCell>
                      <TableCell className="text-right py-1.5">{badge(c.status)}</TableCell>
                    </TableRow>
                  ))}
                  {filtered.length > 100 && (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={6} className="text-center py-3 text-xs text-slate-500 italic bg-slate-50">Showing 100 of {filtered.length} records.</TableCell>
                    </TableRow>
                  )}
                  {filtered.length === 0 && (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={6} className="text-center py-8 text-slate-500">
                        <div className="flex flex-col items-center">
                          <Search className="h-6 w-6 text-slate-300 mb-2" />
                          <p>No records found.</p>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </main>

      {auditLogs !== null ? (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-[700px] max-h-[85vh] flex flex-col">
            <div className="p-4 border-b flex justify-between items-center">
              <h2 className="text-lg font-bold flex items-center gap-2 text-slate-800"><History className="h-5 w-5" /> Audit History: Document ID {selected?.id}</h2>
              <Button variant="ghost" size="sm" onClick={() => setAuditLogs(null)}>Close</Button>
            </div>
            <div className="p-4 overflow-y-auto flex-1 space-y-4">
              {loadingAudit ? <p className="text-slate-500 animate-pulse text-center my-8">Loading forensic timeline...</p> : auditLogs.length === 0 ? <p className="text-slate-500 text-sm text-center my-8 bg-slate-50 py-10 rounded">No specific UI edits recorded yet.</p> :
                auditLogs.map((log) => (
                  <div key={log.id} className={`p-4 rounded-xl border ${log.action === 'DELETE' ? 'bg-red-50 border-red-200' : 'bg-slate-50 border-slate-200'}`}>
                    <div className="flex justify-between items-start mb-3">
                      <Badge variant={log.action === 'DELETE' ? 'destructive' : 'secondary'} className="px-3 py-1 uppercase tracking-wider">{log.action}</Badge>
                      <span className="text-xs font-mono text-slate-500 bg-white border px-2 py-1 rounded">{new Date(log.timestamp).toLocaleString()}</span>
                    </div>
                    <p className="text-sm font-medium mb-3 text-slate-700">Editor Accountability: <span className="font-mono bg-white px-2 py-1 rounded border text-slate-900">{log.editor}</span></p>
                    {log.action === 'EDIT' && (
                      <div className="grid grid-cols-2 gap-3 text-[10px] font-mono mt-4 border-t pt-4 border-slate-200">
                        <div className="bg-white p-3 rounded-lg border border-slate-200 overflow-x-auto shadow-sm tracking-tight"><p className="font-bold text-slate-400 mb-2 uppercase text-xs tracking-widest">Previous State</p><pre>{JSON.stringify(log.previous_data, null, 2)}</pre></div>
                        <div className="bg-white p-3 rounded-lg border border-slate-200 overflow-x-auto shadow-sm tracking-tight"><p className="font-bold text-emerald-500 mb-2 uppercase text-xs tracking-widest">New Edits</p><pre>{JSON.stringify(log.new_data, null, 2)}</pre></div>
                      </div>
                    )}
                    {log.action === 'DELETE' && (
                      <div className="mt-4 border-t pt-4 border-red-200 text-[10px] font-mono">
                        <div className="bg-white p-3 rounded-lg border border-red-200 overflow-x-auto shadow-sm"><p className="font-bold text-red-500 mb-2 uppercase text-xs tracking-widest">Final Archived State Before Deletion</p><pre className="text-red-900">{JSON.stringify(log.previous_data, null, 2)}</pre></div>
                      </div>
                    )}
                  </div>
                ))
              }
            </div>
          </div>
        </div>
      ) : null}
       {showAssetModal ? (
         <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
           <div className="bg-emerald-50 text-emerald-950 rounded-2xl shadow-2xl w-[520px] flex flex-col overflow-hidden border border-emerald-200">
             <div className="p-4 border-b border-emerald-200 flex justify-between items-center bg-emerald-100/50">
               <div>
                 <h2 className="text-base font-bold flex items-center gap-2 text-emerald-800"><Bot className="h-5 w-5 text-emerald-600" /> Satellite Land-Cover Scan</h2>
                 <p className="text-[11px] text-emerald-600 mt-0.5 font-medium">Claim ID: <span className="font-mono bg-emerald-200/50 px-1.5 py-0.5 rounded">{selected?.claim_id || selected?.id}</span></p>
               </div>
               <button
                 onClick={() => setShowAssetModal(false)}
                 className="p-2 rounded-full hover:bg-emerald-200/50 text-emerald-700 transition-colors"
               >
                 <XCircle className="h-5 w-5" />
               </button>
             </div>
             
             <div className="p-6">
               {loadingAsset ? (
                 <div className="flex flex-col items-center py-12 space-y-4">
                   <div className="relative">
                     <Bot className="h-12 w-12 text-emerald-500 animate-bounce" />
                     <div className="absolute -bottom-2 w-12 h-1 bg-emerald-200 rounded-full blur-sm animate-pulse" />
                   </div>
                   <p className="text-emerald-700 font-medium animate-pulse text-sm">Processing Satellite Imagery...</p>
                 </div>
               ) : !assetData || assetData.error ? (
                 <div className="py-12 text-center text-emerald-600/70 bg-white/50 rounded-xl border border-dashed border-emerald-200">
                   <Info className="h-10 w-10 mx-auto mb-3 opacity-20" />
                   <p className="text-sm font-medium">{assetData?.error || "Satellite data scanning failed for this quadrant."}</p>
                 </div>
               ) : (
                 <div className="space-y-5">
                   {/* Results Overview */}
                   <div className="grid grid-cols-2 gap-4">
                     <div className="p-4 rounded-2xl bg-white border border-emerald-100 shadow-sm flex flex-col items-center text-center">
                       <p className="text-[10px] text-emerald-600 font-bold uppercase tracking-widest mb-1">Confidence</p>
                       <p className="text-3xl font-black text-emerald-800">{(assetData.confidence * 100).toFixed(0)}%</p>
                       <div className="w-full h-1.5 bg-emerald-100 rounded-full mt-3 overflow-hidden">
                         <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${assetData.confidence * 100}%` }} />
                       </div>
                     </div>
                     <div className="p-4 rounded-2xl bg-emerald-800 text-white shadow-md shadow-emerald-900/10 flex flex-col items-center text-center">
                       <p className="text-[10px] text-emerald-200 font-bold uppercase tracking-widest mb-1">Terrain Class</p>
                       <p className="text-xl font-bold leading-tight mt-1">{assetData.land_cover_class || "No Data"}</p>
                       <Layers3 className="h-5 w-5 mt-3 opacity-40" />
                     </div>
                   </div>

                   <p className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-800/50 px-1 pt-2">AI Resource Classification</p>

                   <div className="grid grid-cols-1 gap-3">
                     {/* Water Card */}
                     <div className={`flex items-center gap-4 p-4 rounded-2xl border transition-all ${assetData.water_available ? 'bg-blue-50 border-blue-200 shadow-sm' : 'bg-white border-emerald-100 shadow-sm opacity-80'}`}>
                       <div className={`p-3 rounded-xl ${assetData.water_available ? 'bg-blue-500 text-white' : 'bg-emerald-100 text-emerald-400'}`}>
                         {assetData.water_available ? <CheckCircle2 className="h-6 w-6" /> : <XCircle className="h-6 w-6" />}
                       </div>
                       <div>
                         <p className="text-sm font-bold text-emerald-900">{assetData.water_available ? 'Hydrological Resource Confirmed' : 'Water Availability Scan: Negative'}</p>
                         <p className="text-xs text-emerald-700/70 mt-0.5 leading-relaxed">
                           {assetData.water_available 
                             ? 'Our neural network detected distinct spectral signatures of surface water.' 
                             : 'Satellite signatures indicate dry-land characteristics in this specific claim sector.'}
                         </p>
                       </div>
                     </div>

                     {/* Irrigation Card */}
                     <div className={`flex items-center gap-4 p-4 rounded-2xl border transition-all ${assetData.irrigation_detected ? 'bg-emerald-100 border-emerald-300 shadow-sm' : 'bg-white border-emerald-100 shadow-sm opacity-80'}`}>
                       <div className={`p-3 rounded-xl ${assetData.irrigation_detected ? 'bg-emerald-600 text-white' : 'bg-emerald-100 text-emerald-400'}`}>
                         {assetData.irrigation_detected ? <CheckCircle2 className="h-6 w-6" /> : <XCircle className="h-6 w-6" />}
                       </div>
                       <div>
                         <p className="text-sm font-bold text-emerald-900">{assetData.irrigation_detected ? 'Agricultural Systems Detected' : 'No Irrigation Systems Found'}</p>
                         <p className="text-xs text-emerald-700/70 mt-0.5 leading-relaxed">
                           {assetData.irrigation_detected 
                             ? 'Detected geometric patterns consistent with sustained agricultural irrigation.' 
                             : 'Parcel appears to rely on seasonal rainfall or remains uncultivated forest land.'}
                         </p>
                       </div>
                     </div>
                   </div>

                   <div className="flex items-center justify-center gap-2 pt-2 grayscale opacity-30">
                     <p className="text-[9px] font-bold text-emerald-900 tracking-tighter">TF-KERAS SATELLITE ENGINE 2.0</p>
                     <div className="h-1 w-1 rounded-full bg-emerald-900" />
                     <p className="text-[9px] font-bold text-emerald-900 tracking-tighter uppercase italic">Forensic Grade Intelligence</p>
                   </div>
                 </div>
               )}
             </div>
           </div>
         </div>
       ) : null}
    </div>
  );
};


const FilterSelect = ({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (v: string) => void }) => <div className="space-y-2"><Label>{label}</Label><select value={value} onChange={(e) => onChange(e.target.value)} className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"><option value="">All</option>{options.map((o) => <option key={o} value={o}>{o}</option>)}</select></div>;
const LayerToggle = ({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) => <label className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2 text-sm"><span>{label}</span><input type="checkbox" checked={checked} onChange={onChange} className="h-4 w-4" /></label>;
const LegendItem = ({ label, color, shape }: { label: string; color: string; shape: "circle" | "square" | "diamond" }) => <div className="mb-2 flex items-center gap-3 text-sm"><span className={`inline-block h-4 w-4 border-2 border-slate-700 ${shape === "circle" ? "rounded-full" : shape === "square" ? "rounded-sm" : "rotate-45 rounded-sm"}`} style={{ backgroundColor: color }} /><span>{label}</span></div>;
const StatusLegend = ({ label, color }: { label: string; color: string }) => <div className="mb-2 flex items-center gap-3 text-sm"><span className="inline-block h-4 w-4 rounded-full border-4" style={{ borderColor: color }} /><span>{label}</span></div>;
const AnalyticsItem = ({ label, value }: { label: string; value: number }) => <div className="rounded-xl bg-slate-50 p-2"><p className="text-xs uppercase tracking-[0.18em] text-slate-500">{label}</p><p className="text-lg font-semibold text-slate-950">{value}</p></div>;
const InfoField = ({ label, value }: { label: string; value: string }) => <div className="rounded-xl bg-slate-50 p-2"><p className="text-xs uppercase tracking-[0.18em] text-slate-500">{label}</p><p className="font-medium text-slate-950">{value || "-"}</p></div>;
const EditField = ({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) => <div className="space-y-1"><Label>{label}</Label><Input value={value} onChange={(e) => onChange(e.target.value)} /></div>;
const SelectField = ({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (v: string) => void }) => <div className="space-y-1"><Label>{label}</Label><select value={value} onChange={(e) => onChange(e.target.value)} className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm">{options.map((o) => <option key={o} value={o}>{o}</option>)}</select></div>;
export default AtlasEnhanced;
