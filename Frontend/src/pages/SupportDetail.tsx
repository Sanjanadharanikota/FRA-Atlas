import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, FileText, Lightbulb, MapPin, Sparkles } from "lucide-react";
import { apiFetch } from "@/lib/api";

type Applicant = {
  id: number;
  patta_holder_name?: string;
  village_name?: string;
  district?: string;
  state?: string;
  claim_id?: string;
  claim_type?: string;
  land_use?: string;
  total_area_claimed?: string;
  status?: string;
  asset_data?: {
    land_type?: string;
    water_available?: boolean;
    irrigation?: boolean;
    confidence?: number;
  } | null;
};

type Citation = {
  source?: string;
  page?: number;
  snippet?: string;
};

type Recommendation = {
  scheme: string;
  priority?: string;
  reason?: string;
  eligibility_note?: string;
  supporting_sources?: Citation[];
};

type ApplicantResponse = {
  status: string;
  summary?: string;
  applicant_profile?: Applicant;
  recommended_schemes?: Recommendation[];
  source_count?: number;
  knowledge_base_status?: string;
  retrieval_error?: string | null;
};

const getPriorityColor = (priority?: string) => {
  switch ((priority || "").toLowerCase()) {
    case "high":
      return "bg-red-100 text-red-700 border-red-200";
    case "medium":
      return "bg-amber-100 text-amber-700 border-amber-200";
    case "low":
      return "bg-emerald-100 text-emerald-700 border-emerald-200";
    default:
      return "bg-muted text-muted-foreground border-border";
  }
};

const getBooleanLabel = (value?: boolean | null) => {
  if (value === undefined || value === null) return "-";
  return value ? "Detected" : "Not detected";
};

const SupportDetail = () => {
  const navigate = useNavigate();
  const { applicantId } = useParams();
  const [note, setNote] = useState("");
  const [result, setResult] = useState<ApplicantResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadRecommendations = async (customNote?: string) => {
    if (!applicantId) return;

    try {
      setLoading(true);
      setError(null);
      const payload = await apiFetch(`/dss/applicants/${applicantId}/recommendations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: (customNote ?? note.trim()) || null }),
      });
      setResult(payload.data as ApplicantResponse);
    } catch (err) {
      console.error(err);
      setError("Could not load land details and recommendations for this record.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadRecommendations("");
  }, [applicantId]);

  return (
    <div className="fra-container py-8">
      <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="mb-2 text-3xl font-bold">Decision Support System</h1>
          <p className="text-muted-foreground">
            Step 2: land details and recommended schemes for the selected FRA record.
          </p>
        </div>
        <Button variant="outline" onClick={() => navigate("/support")}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Select Record
        </Button>
      </div>

      {error && (
        <Card className="mb-6 border-red-200">
          <CardContent className="py-4 text-sm text-red-600">{error}</CardContent>
        </Card>
      )}

      {loading && !result ? (
        <Card className="border-dashed">
          <CardContent className="py-16 text-center text-muted-foreground">
            Loading land details and scheme recommendations...
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          <Card className="bg-gradient-card">
            <CardHeader>
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <MapPin className="h-5 w-5" />
                    {result?.applicant_profile?.patta_holder_name || "Selected Applicant"}
                  </CardTitle>
                  <CardDescription>
                    {[result?.applicant_profile?.village_name, result?.applicant_profile?.district, result?.applicant_profile?.state]
                      .filter(Boolean)
                      .join(", ")}
                  </CardDescription>
                </div>
                <div className="flex flex-wrap gap-2">
                  {result?.applicant_profile?.claim_id && <Badge variant="outline">{result.applicant_profile.claim_id}</Badge>}
                  {result?.applicant_profile?.claim_type && <Badge variant="outline">{result.applicant_profile.claim_type}</Badge>}
                  {result?.knowledge_base_status && <Badge variant="outline">KB: {result.knowledge_base_status}</Badge>}
                  {typeof result?.source_count === "number" && <Badge variant="outline">{result.source_count} cited sources</Badge>}
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">{result?.summary}</p>
              <div className="flex flex-wrap gap-2">
                {result?.applicant_profile?.land_use && <Badge className="bg-primary/10 text-primary">{result.applicant_profile.land_use}</Badge>}
                {result?.applicant_profile?.total_area_claimed && <Badge variant="secondary">{result.applicant_profile.total_area_claimed}</Badge>}
                {result?.applicant_profile?.status && <Badge variant="secondary">{result.applicant_profile.status}</Badge>}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Land Details</CardTitle>
              <CardDescription>
                The support system uses these extracted FRA details for recommendation.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                <div className="rounded-lg border p-3 text-sm">
                  <p className="text-muted-foreground">Applicant</p>
                  <p className="font-medium">{result?.applicant_profile?.patta_holder_name || "-"}</p>
                </div>
                <div className="rounded-lg border p-3 text-sm">
                  <p className="text-muted-foreground">Claim ID</p>
                  <p className="font-medium">{result?.applicant_profile?.claim_id || "-"}</p>
                </div>
                <div className="rounded-lg border p-3 text-sm">
                  <p className="text-muted-foreground">Type</p>
                  <p className="font-medium">{result?.applicant_profile?.claim_type || "-"}</p>
                </div>
                <div className="rounded-lg border p-3 text-sm">
                  <p className="text-muted-foreground">Village</p>
                  <p className="font-medium">{result?.applicant_profile?.village_name || "-"}</p>
                </div>
                <div className="rounded-lg border p-3 text-sm">
                  <p className="text-muted-foreground">District / State</p>
                  <p className="font-medium">
                    {[result?.applicant_profile?.district, result?.applicant_profile?.state].filter(Boolean).join(", ") || "-"}
                  </p>
                </div>
                <div className="rounded-lg border p-3 text-sm">
                  <p className="text-muted-foreground">Land / Area</p>
                  <p className="font-medium">
                    {[result?.applicant_profile?.land_use, result?.applicant_profile?.total_area_claimed].filter(Boolean).join(" • ") || "-"}
                  </p>
                </div>
                <div className="rounded-lg border p-3 text-sm">
                  <p className="text-muted-foreground">Satellite Land Type</p>
                  <p className="font-medium">{result?.applicant_profile?.asset_data?.land_type || "-"}</p>
                </div>
                <div className="rounded-lg border p-3 text-sm">
                  <p className="text-muted-foreground">Water Availability</p>
                  <p className="font-medium">{getBooleanLabel(result?.applicant_profile?.asset_data?.water_available)}</p>
                </div>
                <div className="rounded-lg border p-3 text-sm">
                  <p className="text-muted-foreground">Irrigation</p>
                  <p className="font-medium">{getBooleanLabel(result?.applicant_profile?.asset_data?.irrigation)}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Optional Context</CardTitle>
              <CardDescription>
                Add a specific need if you want recommendations to focus on it.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4 md:flex-row">
              <div className="flex-1">
                <Label htmlFor="support-context">Context</Label>
                <Input
                  id="support-context"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Example: prioritize irrigation and livelihood support"
                  className="mt-2"
                />
              </div>
              <div className="flex items-end">
                <Button onClick={() => void loadRecommendations()} disabled={loading}>
                  <Sparkles className="mr-2 h-4 w-4" />
                  {loading ? "Refreshing..." : "Apply Context"}
                </Button>
              </div>
            </CardContent>
          </Card>

          <div className="space-y-4">
            <div>
              <h2 className="text-2xl font-semibold">Recommended Schemes</h2>
              <p className="text-muted-foreground">
                These suggestions are generated for the selected land record.
              </p>
            </div>

            {result?.recommended_schemes?.map((recommendation, index) => (
              <Card key={`${recommendation.scheme}-${index}`} className="overflow-hidden">
                <CardHeader>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <CardTitle className="flex items-center gap-2 text-lg">
                        <Lightbulb className="h-5 w-5 text-warning" />
                        {recommendation.scheme}
                      </CardTitle>
                      {recommendation.reason && (
                        <CardDescription className="mt-2">
                          {recommendation.reason}
                        </CardDescription>
                      )}
                    </div>
                    <Badge className={getPriorityColor(recommendation.priority)}>
                      {recommendation.priority || "Info"}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {recommendation.eligibility_note && (
                    <div className="rounded-lg bg-muted/50 p-3 text-sm">
                      <span className="font-medium">Eligibility note:</span> {recommendation.eligibility_note}
                    </div>
                  )}

                  {recommendation.supporting_sources?.length ? (
                    <div className="space-y-3">
                      <h4 className="flex items-center gap-2 font-medium">
                        <FileText className="h-4 w-4" />
                        Supporting Sources
                      </h4>
                      {recommendation.supporting_sources.map((source, sourceIndex) => (
                        <div key={`${source.source}-${sourceIndex}`} className="rounded-lg border border-dashed p-3 text-sm">
                          <p className="font-medium">
                            {source.source || "Policy document"}
                            {source.page ? ` • Page ${source.page}` : ""}
                          </p>
                          {source.snippet && (
                            <p className="mt-2 text-muted-foreground">{source.snippet}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            ))}

            {!result?.recommended_schemes?.length && !loading && (
              <Card>
                <CardContent className="py-8 text-center text-muted-foreground">
                  No scheme suggestions were generated for this applicant yet.
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default SupportDetail;
