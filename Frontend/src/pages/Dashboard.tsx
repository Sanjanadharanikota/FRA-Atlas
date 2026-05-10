import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { BarChart3, Clock, Download, FileText, Filter, Globe2, MapPin, TimerReset, TrendingUp, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { apiFetch } from "@/lib/api";
const TRACKED_STATES = [
  "Chhattisgarh",
  "Madhya Pradesh",
  "Odisha",
  "Tripura",
  "Jharkhand",
] as const;

type Claim = {
  id: number;
  patta_holder_name?: string;
  village_name?: string;
  district?: string;
  state?: string;
  total_area_claimed?: string;
  coordinates?: string;
  claim_id?: string;
  status?: string;
  created_at?: string;
};

const Dashboard = () => {
  const navigate = useNavigate();
  const [claims, setClaims] = useState<Claim[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [chainStatus, setChainStatus] = useState<"idle" | "safe" | "error">("idle");
  const [chainMessage, setChainMessage] = useState("");

  const verifyIntegrity = async () => {
    try {
      const data = await apiFetch(`/upload/verify-chain`);
      setChainStatus(data.status);
      setChainMessage(data.message);
    } catch {
      setChainStatus("error");
      setChainMessage("Could not connect to integrity Node");
    }
  };

  useEffect(() => {
    const loadClaims = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await apiFetch(`/upload/all?page=1&page_size=500`);
        const results = Array.isArray(data.data) ? data.data : [];
        setClaims(results);
      } catch (err) {
        console.error("Dashboard load error:", err);
        setError("Could not load live dashboard data.");
        setClaims([]);
      } finally {
        setLoading(false);
      }
    };

    void loadClaims();
  }, []);

  const dashboard = useMemo(() => {
    const normalized = claims.map((claim) => ({
      ...claim,
      status: (claim.status || "pending").toLowerCase(),
      state: claim.state || "Unknown",
      district: claim.district || "Unknown",
      village_name: claim.village_name || "Unknown",
      patta_holder_name: claim.patta_holder_name || "Unknown",
      coordinates: claim.coordinates || "",
    }));

    const totalClaims = normalized.length;
    const pendingClaims = normalized.filter((claim) => claim.status === "pending").length;
    const mappedClaims = normalized.filter((claim) => {
      const [lat, lng] = claim.coordinates.split(",").map(Number);
      return !Number.isNaN(lat) && !Number.isNaN(lng);
    }).length;
    const coveredStates = new Set(normalized.map((claim) => claim.state)).size;

    const stateBase = TRACKED_STATES.reduce<Record<string, { state: string; claims: number; verified: number }>>(
      (acc, state) => {
        acc[state] = { state, claims: 0, verified: 0 };
        return acc;
      },
      {}
    );

    const byState = Object.values(
      normalized.reduce<Record<string, { state: string; claims: number; verified: number }>>((acc, claim) => {
        if (!TRACKED_STATES.includes(claim.state as (typeof TRACKED_STATES)[number])) {
          return acc;
        }
        acc[claim.state].claims += 1;
        if (claim.status === "verified" || claim.status === "approved") {
          acc[claim.state].verified += 1;
        }
        return acc;
      }, stateBase)
    ).map((item) => ({
      ...item,
      progress: item.claims ? Math.round((item.verified / item.claims) * 100) : 0,
    }));

    const recentActivity = normalized
      .slice()
      .sort((a, b) => {
        const aTime = a.created_at ? new Date(a.created_at).getTime() : 0;
        const bTime = b.created_at ? new Date(b.created_at).getTime() : 0;
        return bTime - aTime;
      })
      .slice(0, 5)
      .map((claim) => ({
        id: claim.id,
        action: claim.claim_id ? `Claim ${claim.claim_id} saved` : "Claim record saved",
        location: `${claim.village_name}, ${claim.state}`,
        time: claim.created_at ? formatRelativeTime(claim.created_at) : "Just now",
        status: claim.status || "pending",
      }));

    return {
      totalClaims,
      pendingClaims,
      mappedClaims,
      coveredStates,
      byState,
      recentActivity,
    };
  }, [claims]);

  const getStatusBadge = (status: string) => {
    switch ((status || "").toLowerCase()) {
      case "verified":
      case "approved":
        return <Badge className="status-verified">Verified</Badge>;
      case "pending":
        return <Badge className="status-pending">Pending</Badge>;
      case "rejected":
        return <Badge variant="destructive">Rejected</Badge>;
      default:
        return <Badge variant="secondary">{status || "Unknown"}</Badge>;
    }
  };

  const kpiData = [
    {
      title: "Total Claims",
      value: dashboard.totalClaims,
      subtitle: "Records saved in database",
      icon: FileText,
      tint: "bg-sky-500",
    },
    {
      title: "Pending Claims",
      value: dashboard.pendingClaims,
      subtitle: "Awaiting status update",
      icon: TimerReset,
      tint: "bg-amber-500",
    },
    {
      title: "Mapped Claims",
      value: dashboard.mappedClaims,
      subtitle: "Ready for Atlas view",
      icon: MapPin,
      tint: "bg-emerald-600",
    },
    {
      title: "Covered States",
      value: dashboard.coveredStates,
      subtitle: "Distinct states in records",
      icon: Globe2,
      tint: "bg-indigo-600",
    },
  ];

  return (
    <div className="fra-container py-8">
      <div className="flex flex-col justify-between gap-4 mb-8 lg:flex-row lg:items-center">
        <div>
          <h1 className="text-3xl font-bold mb-2">FRA Dashboard</h1>
          <p className="text-muted-foreground">
            Live overview of claims currently saved in the portal database
          </p>
        </div>
        <div className="flex flex-col gap-2 items-end">
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={verifyIntegrity}>
              <ShieldCheck className="h-4 w-4 mr-2 text-indigo-600" />
              Check Data Integrity
            </Button>
            <Button variant="outline" size="sm" disabled>
              <Filter className="h-4 w-4 mr-2" />
              Live View
            </Button>
            <Button variant="outline" size="sm" disabled>
              <Download className="h-4 w-4 mr-2" />
              Export
            </Button>
          </div>
          {chainStatus === "safe" && (
            <div className="text-sm bg-green-100 text-green-800 px-3 py-1 rounded-md border border-green-300">
              ✅ {chainMessage}
            </div>
          )}
          {chainStatus === "error" && (
            <div className="text-sm bg-red-100 text-red-800 px-3 py-1 rounded-md border border-red-300">
              🚨 {chainMessage}
            </div>
          )}
        </div>
      </div>

      {error && (
        <Card className="mb-6 border-red-200">
          <CardContent className="py-4 text-sm text-red-600">{error}</CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-6 mb-8 md:grid-cols-2 lg:grid-cols-4">
        {kpiData.map((kpi) => (
          <Card key={kpi.title} className="hover-lift">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {kpi.title}
              </CardTitle>
              <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${kpi.tint}`}>
                <kpi.icon className="h-4 w-4 text-white" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {loading ? "..." : kpi.value.toLocaleString()}
              </div>
              <div className="flex items-center text-xs text-muted-foreground">
                <TrendingUp className="h-3 w-3 mr-1" />
                <span>{kpi.subtitle}</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-8 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5" />
                Claims by State
              </CardTitle>
              <CardDescription>
                Verification progress based on live saved records
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <p className="text-sm text-muted-foreground">Loading state metrics...</p>
              ) : dashboard.byState.length === 0 ? (
                <p className="text-sm text-muted-foreground">No saved claims yet.</p>
              ) : (
                <div className="space-y-4">
                  {dashboard.byState.map((item) => (
                    <div key={item.state} className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="font-medium">{item.state}</span>
                        <span className="text-muted-foreground">
                          {item.verified}/{item.claims} verified
                        </span>
                      </div>
                      <Progress value={item.progress} className="h-2" />
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>{item.progress}% completed</span>
                        <span>{item.claims - item.verified} pending</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5" />
                Recent Activity
              </CardTitle>
              <CardDescription>
                Latest saved records
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <p className="text-sm text-muted-foreground">Loading recent activity...</p>
              ) : dashboard.recentActivity.length === 0 ? (
                <p className="text-sm text-muted-foreground">No activity yet.</p>
              ) : (
                <div className="space-y-4">
                  {dashboard.recentActivity.map((activity) => (
                    <div key={activity.id} className="flex items-start space-x-3 rounded-lg bg-muted/50 p-3">
                      <div className="mt-2 h-2 w-2 rounded-full bg-primary" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">{activity.action}</p>
                        <p className="text-xs text-muted-foreground">{activity.location}</p>
                        <div className="mt-2 flex items-center justify-between">
                          <span className="text-xs text-muted-foreground">{activity.time}</span>
                          {getStatusBadge(activity.status)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="mt-8">
        <Card>
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
            <CardDescription>
              Navigate to the main live workflows
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <Button variant="outline" className="justify-start h-auto p-4" onClick={() => navigate("/atlas")}>
                <div className="flex items-center space-x-3">
                  <MapPin className="h-8 w-8 text-primary" />
                  <div className="text-left">
                    <div className="font-medium">View Atlas</div>
                    <div className="text-sm text-muted-foreground">Inspect saved map records</div>
                  </div>
                </div>
              </Button>
              <Button variant="outline" className="justify-start h-auto p-4" onClick={() => navigate("/upload")}>
                <div className="flex items-center space-x-3">
                  <FileText className="h-8 w-8 text-accent" />
                  <div className="text-left">
                    <div className="font-medium">Upload Documents</div>
                    <div className="text-sm text-muted-foreground">Review and save claims</div>
                  </div>
                </div>
              </Button>
              <Button variant="outline" className="justify-start h-auto p-4" onClick={() => navigate("/atlas")}>
                <div className="flex items-center space-x-3">
                  <Globe2 className="h-8 w-8 text-warning" />
                  <div className="text-left">
                    <div className="font-medium">Manage Records</div>
                    <div className="text-sm text-muted-foreground">Search and delete saved entries</div>
                  </div>
                </div>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

const formatRelativeTime = (value: string) => {
  const date = new Date(value);
  const diffMs = Date.now() - date.getTime();
  if (Number.isNaN(diffMs) || diffMs < 0) return "Just now";

  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;

  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
};

export default Dashboard;
