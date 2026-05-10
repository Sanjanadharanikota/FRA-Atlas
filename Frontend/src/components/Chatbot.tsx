import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  FileText,
  Lightbulb,
  Loader2,
  MapPin,
  MessageCircle,
  Search,
  Sparkles,
  User,
  X,
} from "lucide-react";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "http://127.0.0.1:8000";

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

const getPriorityStyles = (priority?: string) => {
  switch ((priority || "").toLowerCase()) {
    case "high":
      return {
        badge: "bg-red-100 text-red-700 border-red-200",
        rail: "bg-red-500",
      };
    case "medium":
      return {
        badge: "bg-amber-100 text-amber-700 border-amber-200",
        rail: "bg-amber-500",
      };
    case "low":
      return {
        badge: "bg-emerald-100 text-emerald-700 border-emerald-200",
        rail: "bg-emerald-500",
      };
    default:
      return {
        badge: "bg-muted text-muted-foreground border-border",
        rail: "bg-slate-400",
      };
  }
};

const Chatbot = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [records, setRecords] = useState<Applicant[]>([]);
  const [selectedRecordId, setSelectedRecordId] = useState<string>("");
  const [contextNote, setContextNote] = useState("");
  const [searchValue, setSearchValue] = useState("");
  const [result, setResult] = useState<ApplicantResponse | null>(null);
  const [loadingRecords, setLoadingRecords] = useState(false);
  const [loadingRecommendations, setLoadingRecommendations] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<1 | 2>(1);

  useEffect(() => {
    if (!isOpen) return;

    const loadRecords = async () => {
      try {
        setLoadingRecords(true);
        setError(null);
        const response = await fetch(`${BACKEND_URL}/dss/applicants`);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const data = await response.json();
        const rows = Array.isArray(data.applicants) ? data.applicants : [];
        setRecords(rows);
        if (!selectedRecordId && rows.length > 0) {
          setSelectedRecordId(String(rows[0].id));
        }
      } catch (err) {
        console.error(err);
        setError("Could not load saved FRA records.");
      } finally {
        setLoadingRecords(false);
      }
    };

    void loadRecords();
  }, [isOpen]);

  const filteredRecords = useMemo(() => {
    const query = searchValue.trim().toLowerCase();
    if (!query) return records;
    return records.filter((record) =>
      [
        record.patta_holder_name,
        record.claim_id,
        record.claim_type,
        record.village_name,
        record.district,
        record.state,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query)),
    );
  }, [records, searchValue]);

  const selectedRecord = useMemo(
    () => records.find((record) => String(record.id) === selectedRecordId) || null,
    [records, selectedRecordId],
  );

  const loadRecommendations = async (recordId: string, noteOverride?: string) => {
    if (!recordId) return;

    try {
      setLoadingRecommendations(true);
      setError(null);
      const response = await fetch(`${BACKEND_URL}/dss/applicants/${recordId}/recommendations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: (noteOverride ?? contextNote.trim()) || null }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = (await response.json()) as ApplicantResponse;
      setResult(data);
      setStep(2);
    } catch (err) {
      console.error(err);
      setError("Could not generate recommendations for the selected record.");
      setResult(null);
    } finally {
      setLoadingRecommendations(false);
    }
  };

  const handleEnter = async () => {
    if (!selectedRecordId) return;
    await loadRecommendations(selectedRecordId);
  };

  if (!isOpen) {
    return (
      <div className="fixed bottom-5 right-5 z-[9999]">
        <Button
          onClick={() => setIsOpen(true)}
          size="lg"
          className="h-14 w-14 rounded-2xl shadow-interactive"
          variant="hero"
        >
          <MessageCircle className="h-6 w-6" />
        </Button>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[9999] bg-slate-950/25 backdrop-blur-[2px]">
      <div className="ml-auto flex h-full w-full max-w-[1100px] flex-col bg-background shadow-2xl">
        <div className="border-b bg-[linear-gradient(135deg,hsl(210_40%_99%),hsl(158_35%_97%))]">
          <div className="flex items-start justify-between gap-4 px-6 py-6 lg:px-8">
            <div className="flex items-start gap-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-accent shadow-card">
                <Bot className="h-6 w-6 text-accent-foreground" />
              </div>
              <div className="space-y-2">
                <div>
                  <h2 className="text-3xl font-bold tracking-tight">FRA Assistant</h2>
                  <p className="text-sm text-muted-foreground">
                    Record-specific decision support for individual FRA property holders
                  </p>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <Badge variant={step === 1 ? "default" : "outline"}>1. Select Record</Badge>
                  <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                  <Badge variant={step === 2 ? "default" : "outline"}>2. Land Details & Schemes</Badge>
                </div>
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setIsOpen(false)} className="mt-1">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-auto bg-[linear-gradient(180deg,hsl(210_40%_99%),hsl(0_0%_100%))] px-6 py-6 lg:px-8">
          {error && (
            <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {step === 1 && (
            <div className="mx-auto max-w-5xl space-y-6">
              <Card className="border-0 shadow-card">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-2xl">
                    <User className="h-5 w-5 text-primary" />
                    Select FRA Record
                  </CardTitle>
                  <CardDescription className="text-base">
                    Choose the exact FRA record first. After you click Enter, the next page will load the land details and scheme recommendations for that individual applicant.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-5">
                  <div className="relative max-w-xl">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={searchValue}
                      onChange={(e) => setSearchValue(e.target.value)}
                      placeholder="Search by claim ID, applicant, village, district..."
                      className="h-12 pl-9 bg-white"
                    />
                  </div>

                  {loadingRecords ? (
                    <div className="flex items-center justify-center py-20 text-muted-foreground">
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Loading saved FRA records...
                    </div>
                  ) : (
                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                      {filteredRecords.map((record) => {
                        const isSelected = String(record.id) === selectedRecordId;
                        return (
                          <button
                            key={record.id}
                            type="button"
                            onClick={() => setSelectedRecordId(String(record.id))}
                            className={`rounded-3xl border p-5 text-left transition-all ${
                              isSelected
                                ? "border-primary bg-white shadow-elevated ring-2 ring-primary/15"
                                : "bg-white/90 hover:bg-white hover:shadow-card"
                            }`}
                          >
                            <div className="mb-4 flex items-start justify-between gap-3">
                              <div>
                                <p className="text-lg font-semibold">{record.patta_holder_name || "Unknown applicant"}</p>
                                <p className="mt-1 font-mono text-xs text-muted-foreground">{record.claim_id || "No claim ID"}</p>
                              </div>
                              <Badge variant="outline" className={isSelected ? "border-primary text-primary" : ""}>
                                {record.claim_type || "Record"}
                              </Badge>
                            </div>
                            <div className="space-y-2 text-sm text-muted-foreground">
                              <p>{record.village_name || "Unknown village"}</p>
                              <p>{[record.district, record.state].filter(Boolean).join(", ") || "Location unavailable"}</p>
                              {record.land_use && <p>{record.land_use}</p>}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {!loadingRecords && !filteredRecords.length && (
                    <Card className="border-dashed">
                      <CardContent className="py-12 text-center text-sm text-muted-foreground">
                        No records match your search.
                      </CardContent>
                    </Card>
                  )}
                </CardContent>
              </Card>

              <Card className="border-0 shadow-card">
                <CardContent className="flex flex-col gap-4 p-6 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="text-sm uppercase tracking-[0.18em] text-muted-foreground">Selected Record</p>
                    <p className="mt-2 text-xl font-semibold">
                      {selectedRecord?.patta_holder_name || "Choose a record to continue"}
                    </p>
                    {selectedRecord && (
                      <p className="mt-1 text-sm text-muted-foreground">
                        {[selectedRecord.claim_id, selectedRecord.claim_type, selectedRecord.village_name].filter(Boolean).join(" • ")}
                      </p>
                    )}
                  </div>
                  <Button
                    onClick={() => void handleEnter()}
                    disabled={!selectedRecordId || loadingRecommendations}
                    className="h-12 min-w-40"
                  >
                    {loadingRecommendations ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Loading...
                      </>
                    ) : (
                      <>
                        Enter
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </>
                    )}
                  </Button>
                </CardContent>
              </Card>
            </div>
          )}

          {step === 2 && (
            <div className="mx-auto max-w-6xl space-y-6">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <h3 className="text-2xl font-semibold">Land Details & Recommended Schemes</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Recommendations are generated using the selected FRA record and indexed policy documents.
                  </p>
                </div>
                <div className="flex gap-3">
                  <Button variant="outline" onClick={() => setStep(1)}>
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Back
                  </Button>
                  <Button onClick={() => void loadRecommendations(selectedRecordId)} disabled={loadingRecommendations}>
                    <Sparkles className="mr-2 h-4 w-4" />
                    {loadingRecommendations ? "Refreshing..." : "Refresh"}
                  </Button>
                </div>
              </div>

              <Card className="border-0 shadow-card overflow-hidden">
                <CardHeader className="bg-[linear-gradient(135deg,hsl(158_48%_18%),hsl(210_85%_40%))] text-white">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <CardTitle className="text-2xl text-white">
                        {result?.applicant_profile?.patta_holder_name || selectedRecord?.patta_holder_name || "Selected Record"}
                      </CardTitle>
                      <CardDescription className="mt-2 text-slate-100">
                        {[selectedRecord?.village_name, selectedRecord?.district, selectedRecord?.state].filter(Boolean).join(", ")}
                      </CardDescription>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {selectedRecord?.claim_id && (
                        <Badge className="border-white/25 bg-white/15 text-white hover:bg-white/15">
                          {selectedRecord.claim_id}
                        </Badge>
                      )}
                      {selectedRecord?.claim_type && (
                        <Badge className="border-white/25 bg-white/15 text-white hover:bg-white/15">
                          {selectedRecord.claim_type}
                        </Badge>
                      )}
                      {result?.knowledge_base_status && (
                        <Badge className="border-white/25 bg-white/15 text-white hover:bg-white/15">
                          KB: {result.knowledge_base_status}
                        </Badge>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-5 p-6">
                  <p className="text-sm leading-6 text-muted-foreground">
                    {result?.summary || "The selected FRA record is being used to generate scheme recommendations for this individual beneficiary."}
                  </p>
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    <div className="rounded-2xl border bg-slate-50 p-4">
                      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Claim ID</p>
                      <p className="mt-2 font-mono text-sm font-semibold">{selectedRecord?.claim_id || "-"}</p>
                    </div>
                    <div className="rounded-2xl border bg-slate-50 p-4">
                      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Village</p>
                      <p className="mt-2 text-sm font-semibold">{selectedRecord?.village_name || "-"}</p>
                    </div>
                    <div className="rounded-2xl border bg-slate-50 p-4">
                      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">District / State</p>
                      <p className="mt-2 text-sm font-semibold">
                        {[selectedRecord?.district, selectedRecord?.state].filter(Boolean).join(", ") || "-"}
                      </p>
                    </div>
                    <div className="rounded-2xl border bg-slate-50 p-4">
                      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Land / Area</p>
                      <p className="mt-2 text-sm font-semibold">
                        {[selectedRecord?.land_use, selectedRecord?.total_area_claimed].filter(Boolean).join(" • ") || "-"}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-0 shadow-card">
                <CardHeader>
                  <CardTitle className="text-lg">Optional context for this applicant</CardTitle>
                  <CardDescription>
                    Add a specific need if you want the recommendations to focus on something like irrigation, housing, or livelihood support.
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-4 md:flex-row">
                  <div className="flex-1">
                    <Label htmlFor="fra-context-page2" className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                      Context
                    </Label>
                    <Input
                      id="fra-context-page2"
                      value={contextNote}
                      onChange={(e) => setContextNote(e.target.value)}
                      placeholder="Example: prioritize irrigation and livelihood support"
                      className="mt-2"
                    />
                  </div>
                  <div className="flex items-end">
                    <Button onClick={() => void loadRecommendations(selectedRecordId)} disabled={loadingRecommendations} className="h-10">
                      <Sparkles className="mr-2 h-4 w-4" />
                      Apply Context
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <div className="space-y-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <h4 className="text-xl font-semibold">Recommended Schemes</h4>
                    <p className="text-sm text-muted-foreground">
                      Suggestions tailored to the selected land record.
                    </p>
                  </div>
                  <Badge variant="outline">
                    {result?.recommended_schemes?.length || 0} schemes
                  </Badge>
                </div>

                {loadingRecommendations && (
                  <Card className="border-dashed">
                    <CardContent className="flex items-center justify-center py-10 text-muted-foreground">
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Refreshing recommendations...
                    </CardContent>
                  </Card>
                )}

                {result?.recommended_schemes?.length ? (
                  <div className="grid gap-4">
                    {result.recommended_schemes.map((recommendation, index) => {
                      const priorityStyles = getPriorityStyles(recommendation.priority);
                      return (
                        <Card key={`${recommendation.scheme}-${index}`} className="overflow-hidden border-0 shadow-card">
                          <div className={`h-1.5 ${priorityStyles.rail}`} />
                          <CardContent className="p-0">
                            <div className="grid gap-0 lg:grid-cols-[1.1fr,0.9fr]">
                              <div className="p-6">
                                <div className="flex items-start justify-between gap-4">
                                  <div>
                                    <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">
                                      <Lightbulb className="h-3.5 w-3.5" />
                                      Recommendation
                                    </div>
                                    <h5 className="text-2xl font-semibold">{recommendation.scheme}</h5>
                                  </div>
                                  <Badge className={priorityStyles.badge}>
                                    {recommendation.priority || "Info"}
                                  </Badge>
                                </div>
                                {recommendation.reason && (
                                  <p className="mt-4 text-base leading-7 text-muted-foreground">
                                    {recommendation.reason}
                                  </p>
                                )}
                                {recommendation.eligibility_note && (
                                  <div className="mt-5 rounded-2xl bg-slate-50 p-4 text-sm leading-6">
                                    <span className="font-semibold text-foreground">Why this fits:</span>{" "}
                                    <span className="text-muted-foreground">{recommendation.eligibility_note}</span>
                                  </div>
                                )}
                              </div>

                              <div className="border-t bg-slate-50/80 p-6 lg:border-l lg:border-t-0">
                                <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
                                  <FileText className="h-4 w-4 text-primary" />
                                  Policy citations
                                </div>
                                <div className="space-y-3">
                                  {recommendation.supporting_sources?.length ? (
                                    recommendation.supporting_sources.map((source, sourceIndex) => (
                                      <div key={`${source.source}-${sourceIndex}`} className="rounded-2xl border bg-white p-4">
                                        <p className="text-sm font-semibold">
                                          {source.source || "Policy document"}
                                          {source.page ? ` • Page ${source.page}` : ""}
                                        </p>
                                        {source.snippet && (
                                          <p className="mt-2 text-sm leading-6 text-muted-foreground">{source.snippet}</p>
                                        )}
                                      </div>
                                    ))
                                  ) : (
                                    <div className="rounded-2xl border border-dashed bg-white p-4 text-sm text-muted-foreground">
                                      No citation snippets available for this recommendation.
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                ) : (
                  !loadingRecommendations && (
                    <Card className="border-dashed bg-white/80">
                      <CardContent className="py-16 text-center text-muted-foreground">
                        No recommendations were generated for this record yet.
                      </CardContent>
                    </Card>
                  )
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Chatbot;
