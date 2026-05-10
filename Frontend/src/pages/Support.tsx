import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowRight, Search, User } from "lucide-react";
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
};

const Support = () => {
  const navigate = useNavigate();
  const [applicants, setApplicants] = useState<Applicant[]>([]);
  const [selectedApplicantId, setSelectedApplicantId] = useState<string>("");
  const [search, setSearch] = useState("");
  const [loadingApplicants, setLoadingApplicants] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadApplicants = async () => {
      try {
        setLoadingApplicants(true);
        setError(null);
        const data = await apiFetch(`/dss/applicants?page=1&page_size=500`);
        const rows = Array.isArray(data.data) ? data.data : [];
        setApplicants(rows);
        if (rows.length > 0) {
          setSelectedApplicantId(String(rows[0].id));
        }
      } catch (err) {
        console.error(err);
        setError("Could not load FRA records from the backend.");
      } finally {
        setLoadingApplicants(false);
      }
    };

    void loadApplicants();
  }, []);

  const filteredApplicants = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return applicants;
    return applicants.filter((applicant) =>
      [
        applicant.claim_id,
        applicant.patta_holder_name,
        applicant.claim_type,
        applicant.village_name,
        applicant.district,
        applicant.state,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query)),
    );
  }, [applicants, search]);

  const selectedApplicant = useMemo(
    () => applicants.find((applicant) => String(applicant.id) === selectedApplicantId) || null,
    [applicants, selectedApplicantId],
  );

  return (
    <div className="fra-container py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Decision Support System</h1>
        <p className="text-muted-foreground">
          Step 1: select the FRA record first. After that, the next page will open with land details and recommended schemes for that individual record.
        </p>
      </div>

      <div className="grid gap-8 lg:grid-cols-[1.3fr,0.7fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <User className="h-5 w-5" />
              Select Record
            </CardTitle>
            <CardDescription>
              {loadingApplicants ? "Loading saved FRA records..." : `${filteredApplicants.length} matching records`}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="relative max-w-lg">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by claim ID, applicant, village, district..."
                className="pl-9"
              />
            </div>

            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {error}
              </div>
            )}

            <Card className="overflow-hidden">
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Claim ID</TableHead>
                      <TableHead>Applicant</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Village</TableHead>
                      <TableHead className="w-[120px]">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredApplicants.map((applicant) => {
                      const isSelected = String(applicant.id) === selectedApplicantId;
                      return (
                        <TableRow key={applicant.id} data-state={isSelected ? "selected" : undefined}>
                          <TableCell className="font-mono text-xs">{applicant.claim_id || "-"}</TableCell>
                          <TableCell className="font-medium">{applicant.patta_holder_name || "-"}</TableCell>
                          <TableCell>{applicant.claim_type || "-"}</TableCell>
                          <TableCell>{applicant.village_name || "-"}</TableCell>
                          <TableCell>
                            <Button
                              size="sm"
                              variant={isSelected ? "default" : "outline"}
                              onClick={() => setSelectedApplicantId(String(applicant.id))}
                            >
                              {isSelected ? "Selected" : "Select"}
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </CardContent>
        </Card>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Selected Record</CardTitle>
            <CardDescription>
              Confirm the applicant you want to analyze before moving to the next page.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {selectedApplicant ? (
              <div className="rounded-xl border bg-muted/40 p-4 space-y-2 text-sm">
                <p className="font-semibold">{selectedApplicant.patta_holder_name}</p>
                <p className="text-muted-foreground">
                  {[selectedApplicant.village_name, selectedApplicant.district, selectedApplicant.state].filter(Boolean).join(", ")}
                </p>
                <div className="flex flex-wrap gap-2 pt-2">
                  {selectedApplicant.claim_id && <Badge variant="outline">{selectedApplicant.claim_id}</Badge>}
                  {selectedApplicant.claim_type && <Badge variant="outline">{selectedApplicant.claim_type}</Badge>}
                  {selectedApplicant.total_area_claimed && <Badge variant="secondary">{selectedApplicant.total_area_claimed}</Badge>}
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
                Select a record from the table to continue.
              </div>
            )}

            <Button
              className="w-full"
              disabled={!selectedApplicantId}
              onClick={() => navigate(`/support/${selectedApplicantId}`)}
            >
              Enter
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Support;
