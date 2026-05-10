import React, { useCallback, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiFetch } from "@/lib/api";
import {
  Check,
  Eye,
  FileCheck,
  FileText,
  MapPinned,
  PencilLine,
  Save,
  Scan,
  Upload as UploadIcon,
  X,
} from "lucide-react";

type DocumentFormData = {
  patta_holder_name: string;
  father_or_husband_name: string;
  age: string;
  gender: string;
  address: string;
  village_name: string;
  block: string;
  district: string;
  state: string;
  total_area_claimed: string;
  coordinates: string;
  land_use: string;
  claim_id: string;
  claim_type: string;
  date_of_application: string;
  water_bodies: string;
  forest_cover: string;
  homestead: string;
};

type FormErrors = Partial<Record<keyof DocumentFormData, string>>;

type UploadStatus = "queued" | "extracting" | "review" | "saving" | "saved" | "error";

type UploadedFile = {
  id: string;
  name: string;
  size: number;
  type: string;
  status: UploadStatus;
  progress: number;
  extractedData?: DocumentFormData;
  fileObj: File;
  savedDocId?: number;
};

type SavedManualRecord = {
  docId: number;
  data: DocumentFormData;
};

const emptyDocument = (): DocumentFormData => ({
  patta_holder_name: "",
  father_or_husband_name: "",
  age: "",
  gender: "",
  address: "",
  village_name: "",
  block: "",
  district: "",
  state: "",
  total_area_claimed: "",
  coordinates: "",
  land_use: "",
  claim_id: "",
  claim_type: "",
  date_of_application: "",
  water_bodies: "",
  forest_cover: "",
  homestead: "",
});

const fieldConfig: Array<{
  key: keyof DocumentFormData;
  label: string;
  multiline?: boolean;
  required?: boolean;
  options?: string[];
}> = [
  { key: "claim_id", label: "Claim ID", required: true },
  { key: "patta_holder_name", label: "Applicant / Patta Holder", required: true },
  { key: "father_or_husband_name", label: "Father / Husband Name" },
  { key: "age", label: "Age" },
  { key: "gender", label: "Gender" },
  { key: "address", label: "Address", multiline: true },
  { key: "village_name", label: "Village Name", required: true },
  { key: "block", label: "Block / Tehsil" },
  { key: "district", label: "District", required: true },
  { key: "state", label: "State", required: true },
  { key: "claim_type", label: "Claim Type", required: true, options: ["IFR", "CR", "CFR"] },
  { key: "total_area_claimed", label: "Total Area Claimed", required: true },
  { key: "coordinates", label: "Coordinates" },
  { key: "land_use", label: "Land Use", required: true },
  { key: "date_of_application", label: "Date of Application", required: true },
  { key: "water_bodies", label: "Water Bodies" },
  { key: "forest_cover", label: "Forest Cover" },
  { key: "homestead", label: "Homestead" },
];

const normalizeKeys = (rawData: Record<string, unknown>): DocumentFormData => {
  const map: Record<string, keyof DocumentFormData> = {
    "Patta-Holder Name": "patta_holder_name",
    "Father/Husband Name": "father_or_husband_name",
    "Age": "age",
    "Gender": "gender",
    "Address": "address",
    "Village Name": "village_name",
    "Block": "block",
    "District": "district",
    "State": "state",
    "Total Area Claimed": "total_area_claimed",
    "Coordinates": "coordinates",
    "Land Use": "land_use",
    "Claim ID": "claim_id",
    "Claim Type": "claim_type",
    "Date of Application": "date_of_application",
    "Water bodies": "water_bodies",
    "Forest cover": "forest_cover",
    "Homestead": "homestead",
  };

  const result = emptyDocument();

  Object.entries(rawData).forEach(([key, value]) => {
    const normalizedKey = map[key] ?? (key as keyof DocumentFormData);
    if (normalizedKey in result) {
      result[normalizedKey] = String(value ?? "");
    }
  });

  return result;
};

const requiredFields: Array<keyof DocumentFormData> = [
  "claim_id",
  "patta_holder_name",
  "village_name",
  "district",
  "state",
  "claim_type",
  "total_area_claimed",
  "land_use",
  "date_of_application",
];

const fieldLabels = Object.fromEntries(fieldConfig.map((field) => [field.key, field.label])) as Record<
  keyof DocumentFormData,
  string
>;

const validateDocument = (data: DocumentFormData): FormErrors => {
  const errors: FormErrors = {};

  requiredFields.forEach((field) => {
    if (!String(data[field] ?? "").trim()) {
      errors[field] = `${fieldLabels[field]} is required.`;
    }
  });

  const claimType = data.claim_type.trim().toUpperCase();
  if (claimType && !["IFR", "CR", "CFR"].includes(claimType)) {
    errors.claim_type = "Claim Type must be IFR, CR, or CFR.";
  }

  return errors;
};

const Upload = () => {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [manualDraft, setManualDraft] = useState<DocumentFormData>(emptyDocument());
  const [manualPreview, setManualPreview] = useState<DocumentFormData | null>(null);
  const [fileErrors, setFileErrors] = useState<Record<string, FormErrors>>({});
  const [manualErrors, setManualErrors] = useState<FormErrors>({});
  const [manualPreviewErrors, setManualPreviewErrors] = useState<FormErrors>({});
  const [generatingFileId, setGeneratingFileId] = useState<string | null>(null);
  const [manualVerifying, setManualVerifying] = useState(false);
  const [manualGenerating, setManualGenerating] = useState(false);
  const [manualSaving, setManualSaving] = useState(false);
  const [lastManualSaved, setLastManualSaved] = useState<SavedManualRecord | null>(null);
  const { toast } = useToast();
  const previewRef = useRef<HTMLDivElement>(null);
  const manualPreviewRef = useRef<HTMLDivElement>(null);

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      void handleFiles(Array.from(e.dataTransfer.files));
    }
  }, []);

  const handleFiles = async (fileList: File[]) => {
    const newFiles: UploadedFile[] = fileList.map((file, index) => ({
      id: `${Date.now()}-${index}`,
      name: file.name,
      size: file.size,
      type: file.type,
      status: "queued",
      progress: 0,
      fileObj: file,
    }));

    setFiles((prev) => [...prev, ...newFiles]);

    for (const file of newFiles) {
      await previewFile(file);
    }
  };

  const previewFile = async (file: UploadedFile) => {
    try {
      setFiles((prev) =>
        prev.map((current) =>
          current.id === file.id ? { ...current, status: "extracting", progress: 50 } : current
        )
      );

      const formData = new FormData();
      formData.append("file", file.fileObj);

      const raw = await apiFetch("/upload/", {
        method: "POST",
        body: formData,
      });
      const normalized = normalizeKeys(raw.data);

      setFiles((prev) =>
        prev.map((current) =>
          current.id === file.id
            ? { ...current, status: "review", progress: 100, extractedData: normalized }
            : current
        )
      );

      toast({
        title: "Review required",
        description: `${file.name} is ready for verification before saving.`,
      });
      previewRef.current?.scrollIntoView({ behavior: "smooth" });
    } catch (error) {
      console.error(error);
      setFiles((prev) =>
        prev.map((current) =>
          current.id === file.id ? { ...current, status: "error", progress: 100 } : current
        )
      );

      toast({
        title: "Extraction failed",
        description: `${file.name} could not be prepared for review.`,
        variant: "destructive",
      });
    }
  };

  const saveDocument = async (payload: DocumentFormData) => {
    const res = await apiFetch(`/upload/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return res;
  };

  const previewDocument = async (payload: DocumentFormData) => {
    const res = await apiFetch(`/upload/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return res;
  };

  const validateLocationFields = (data: DocumentFormData): FormErrors => {
    const errors: FormErrors = {};
    if (!data.village_name.trim()) errors.village_name = "Village Name is required to generate coordinates.";
    if (!data.district.trim()) errors.district = "District is required to generate coordinates.";
    if (!data.state.trim()) errors.state = "State is required to generate coordinates.";
    return errors;
  };

  const generateFileCoordinates = async (fileId: string) => {
    const currentFile = files.find((file) => file.id === fileId);
    if (!currentFile?.extractedData) return;

    const locationErrors = validateLocationFields(currentFile.extractedData);
    if (Object.keys(locationErrors).length > 0) {
      setFileErrors((prev) => ({ ...prev, [fileId]: { ...prev[fileId], ...locationErrors } }));
      toast({
        title: "Location details required",
        description: "Enter Village Name, District, and State before generating coordinates.",
        variant: "destructive",
      });
      return;
    }

    try {
      setGeneratingFileId(fileId);
      const preview = await previewDocument(currentFile.extractedData);
      const normalized = normalizeKeys(preview.data);
      setFiles((prev) =>
        prev.map((file) =>
          file.id === fileId ? { ...file, extractedData: normalized } : file
        )
      );
      toast({
        title: normalized.coordinates ? "Coordinates generated" : "Coordinates not found",
        description: normalized.coordinates
          ? "Review the detected location before saving."
          : "No matching village center was found for the entered location.",
      });
    } catch (error) {
      console.error(error);
      toast({
        title: "Coordinate generation failed",
        description: error instanceof Error ? error.message : "Could not generate coordinates.",
        variant: "destructive",
      });
    } finally {
      setGeneratingFileId(null);
    }
  };

  const confirmFile = async (fileId: string) => {
    const currentFile = files.find((file) => file.id === fileId);
    if (!currentFile?.extractedData) {
      return;
    }

    const errors = validateDocument(currentFile.extractedData);
    if (Object.keys(errors).length > 0) {
      setFileErrors((prev) => ({ ...prev, [fileId]: errors }));
      toast({
        title: "Required fields missing",
        description: "Complete the marked fields before confirming this record.",
        variant: "destructive",
      });
      return;
    }

    try {
      setFileErrors((prev) => ({ ...prev, [fileId]: {} }));
      setFiles((prev) =>
        prev.map((file) => (file.id === fileId ? { ...file, status: "saving" } : file))
      );

      const saved = await saveDocument(currentFile.extractedData);
      const normalized = normalizeKeys(saved.data);

      setFiles((prev) =>
        prev.map((file) =>
          file.id === fileId
            ? { ...file, status: "saved", extractedData: normalized, savedDocId: saved.data.doc_id }
            : file
        )
      );

      toast({
        title: "Saved to database",
        description: normalized.coordinates
          ? `${currentFile.name} is now available in Atlas.`
          : `${currentFile.name} was saved, but it has no map coordinates yet.`,
      });
    } catch (error) {
      console.error(error);
      setFiles((prev) =>
        prev.map((file) => (file.id === fileId ? { ...file, status: "error" } : file))
      );

      toast({
        title: "Save failed",
        description: error instanceof Error
          ? `${currentFile.name} could not be stored: ${error.message}`
          : `${currentFile.name} could not be stored in the database.`,
        variant: "destructive",
      });
    }
  };

  const updateFileField = (fileId: string, field: keyof DocumentFormData, value: string) => {
    setFiles((prev) =>
      prev.map((file) =>
        file.id === fileId && file.extractedData
          ? { ...file, extractedData: { ...file.extractedData, [field]: value } }
          : file
      )
    );
    setFileErrors((prev) => ({
      ...prev,
      [fileId]: { ...prev[fileId], [field]: undefined },
    }));
  };

  const updateManualField = (field: keyof DocumentFormData, value: string) => {
    setManualDraft((prev) => ({ ...prev, [field]: value }));
    setManualPreview(null);
    setManualErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const verifyManualDraft = async () => {
    const errors = validateDocument(manualDraft);
    if (Object.keys(errors).length > 0) {
      setManualErrors(errors);
      toast({
        title: "Required fields missing",
        description: "Fill the marked fields before moving to verification.",
        variant: "destructive",
      });
      return;
    }

    try {
      setManualVerifying(true);
      setManualErrors({});
      setManualPreviewErrors({});
      setManualPreview({ ...manualDraft, coordinates: "" });
      toast({
        title: "Manual review ready",
        description: "Review the details, then generate coordinates during verification if needed.",
      });
      manualPreviewRef.current?.scrollIntoView({ behavior: "smooth" });
    } catch (error) {
      console.error(error);
      toast({
        title: "Preview failed",
        description: error instanceof Error
          ? `Could not prepare the manual verification view: ${error.message}`
          : "Could not prepare the manual verification view.",
        variant: "destructive",
      });
    } finally {
      setManualVerifying(false);
    }
  };

  const generateManualCoordinates = async () => {
    if (!manualPreview) return;

    const locationErrors = validateLocationFields(manualPreview);
    if (Object.keys(locationErrors).length > 0) {
      setManualPreviewErrors((prev) => ({ ...prev, ...locationErrors }));
      toast({
        title: "Location details required",
        description: "Enter Village Name, District, and State before generating coordinates.",
        variant: "destructive",
      });
      return;
    }

    try {
      setManualGenerating(true);
      const preview = await previewDocument(manualPreview);
      const normalized = normalizeKeys(preview.data);
      setManualPreview(normalized);
      toast({
        title: normalized.coordinates ? "Coordinates generated" : "Coordinates not found",
        description: normalized.coordinates
          ? "Review the detected location before saving."
          : "No matching village center was found for the entered location.",
      });
    } catch (error) {
      console.error(error);
      toast({
        title: "Coordinate generation failed",
        description: error instanceof Error ? error.message : "Could not generate coordinates.",
        variant: "destructive",
      });
    } finally {
      setManualGenerating(false);
    }
  };

  const saveManualDraft = async () => {
    if (!manualPreview) {
      return;
    }

    const errors = validateDocument(manualPreview);
    if (Object.keys(errors).length > 0) {
      setManualPreviewErrors(errors);
      toast({
        title: "Required fields missing",
        description: "Complete the marked fields before saving the record.",
        variant: "destructive",
      });
      return;
    }

    try {
      setManualPreviewErrors({});
      setManualSaving(true);
      const saved = await saveDocument(manualPreview);
      const normalized = normalizeKeys(saved.data);
      setLastManualSaved({
        docId: saved.data.doc_id,
        data: normalized,
      });
      setManualDraft(emptyDocument());
      setManualPreview(null);
      toast({
        title: "Manual entry saved",
        description: normalized.coordinates
          ? "The verified record is now available in Atlas."
          : "The record was saved, but it is missing map coordinates.",
      });
    } catch (error) {
      console.error(error);
      toast({
        title: "Save failed",
        description: error instanceof Error
          ? `The manual entry could not be stored: ${error.message}`
          : "The manual entry could not be stored in the database.",
        variant: "destructive",
      });
    } finally {
      setManualSaving(false);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  };

  const renderDocumentForm = (
    data: DocumentFormData,
    onFieldChange: (field: keyof DocumentFormData, value: string) => void,
    errors: FormErrors = {},
  ) => (
    <div className="grid gap-4 md:grid-cols-2">
      {fieldConfig.map((field) => (
        <div key={field.key} className={field.multiline ? "space-y-2 md:col-span-2" : "space-y-2"}>
          <Label htmlFor={field.key} className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
            {field.label} {field.required ? <span className="text-red-600">*</span> : null}
          </Label>
          {field.options ? (
            <select
              id={field.key}
              value={data[field.key]}
              onChange={(e) => onFieldChange(field.key, e.target.value)}
              className={`flex h-10 w-full rounded-md border px-3 py-2 text-sm ring-offset-background ${
                errors[field.key] ? "border-red-500 bg-red-50" : "border-slate-200 bg-white"
              }`}
            >
              <option value="">Select claim type</option>
              {field.options.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          ) : field.multiline ? (
            <Textarea
              id={field.key}
              value={data[field.key]}
              onChange={(e) => onFieldChange(field.key, e.target.value)}
              rows={3}
              className={errors[field.key] ? "border-red-500 bg-red-50" : "border-slate-200 bg-white"}
            />
          ) : (
            <Input
              id={field.key}
              value={data[field.key]}
              onChange={(e) => onFieldChange(field.key, e.target.value)}
              className={errors[field.key] ? "border-red-500 bg-red-50" : "border-slate-200 bg-white"}
            />
          )}
          {errors[field.key] ? (
            <p className="text-sm text-red-600">{errors[field.key]}</p>
          ) : field.required ? (
            <p className="text-xs text-slate-400">Required</p>
          ) : (
            <p className="text-xs text-slate-400">Optional</p>
          )}
        </div>
      ))}
    </div>
  );

  const getStatusIcon = (status: UploadStatus) => {
    switch (status) {
      case "extracting":
        return <Scan className="h-4 w-4 animate-spin" />;
      case "review":
        return <Eye className="h-4 w-4 text-amber-500" />;
      case "saving":
        return <Save className="h-4 w-4 animate-pulse" />;
      case "saved":
        return <Check className="h-4 w-4 text-green-500" />;
      case "error":
        return <X className="h-4 w-4 text-red-500" />;
      default:
        return <FileText className="h-4 w-4" />;
    }
  };

  const getStatusBadge = (status: UploadStatus) => {
    switch (status) {
      case "queued":
        return <Badge variant="secondary">Queued</Badge>;
      case "extracting":
        return <Badge className="status-pending">Extracting</Badge>;
      case "review":
        return <Badge className="bg-amber-500 text-white">Awaiting Review</Badge>;
      case "saving":
        return <Badge className="bg-blue-600 text-white">Saving</Badge>;
      case "saved":
        return <Badge className="status-verified">Saved</Badge>;
      case "error":
        return <Badge variant="destructive">Error</Badge>;
    }
  };

  const reviewFiles = files.filter((file) => file.extractedData);

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(14,165,233,0.14),_transparent_35%),linear-gradient(180deg,_#f8fafc_0%,_#eef6ff_100%)] py-8">
      <div className="mx-auto max-w-6xl px-4">
        <div className="mb-8 rounded-3xl border border-white/70 bg-white/80 p-8 shadow-[0_24px_80px_rgba(15,23,42,0.08)] backdrop-blur">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-sky-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.25em] text-sky-700">
            Verification First
          </div>
          <h1 className="mb-3 text-4xl font-bold tracking-tight text-slate-950">Document Intake & Verification</h1>
          <p className="max-w-3xl text-slate-600">
            Extract from an uploaded image or enter the claim manually, then verify the information before it is committed to the database and shown on Atlas.
          </p>
        </div>

        {lastManualSaved && (
          <Card className="mb-6 rounded-3xl border border-emerald-200 bg-emerald-50/80 shadow-sm">
            <CardHeader>
              <CardTitle className="text-emerald-900">Last Manual Record Saved</CardTitle>
              <CardDescription className="text-emerald-800">
                Record ID {lastManualSaved.docId}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm text-emerald-950 md:grid-cols-2">
              <p><strong>Applicant:</strong> {lastManualSaved.data.patta_holder_name || "Unknown"}</p>
              <p><strong>Village:</strong> {lastManualSaved.data.village_name || "Unknown"}</p>
              <p><strong>District:</strong> {lastManualSaved.data.district || "Unknown"}</p>
              <p><strong>State:</strong> {lastManualSaved.data.state || "Unknown"}</p>
              <p><strong>Coordinates:</strong> {lastManualSaved.data.coordinates || "Not generated"}</p>
              <p><strong>Atlas status:</strong> {lastManualSaved.data.coordinates ? "Map-ready" : "Saved only, not map-ready"}</p>
            </CardContent>
          </Card>
        )}

        <Tabs defaultValue="upload" className="space-y-6">
          <TabsList className="h-auto rounded-2xl bg-slate-100 p-1">
            <TabsTrigger value="upload" className="rounded-xl px-5 py-2.5">Upload Image</TabsTrigger>
            <TabsTrigger value="manual" className="rounded-xl px-5 py-2.5">Manual Entry</TabsTrigger>
          </TabsList>

          <TabsContent value="upload" className="space-y-6">
            <Card className="rounded-3xl border-0 bg-white/90 shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-slate-900">
                  <UploadIcon className="h-5 w-5 text-sky-600" />
                  Upload for OCR Review
                </CardTitle>
                <CardDescription>
                  The image is extracted first. Nothing is saved until the user confirms the reviewed fields.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div
                  className={`relative rounded-3xl border-2 border-dashed p-10 text-center transition-colors ${
                    dragActive ? "border-sky-500 bg-sky-50" : "border-slate-200 bg-slate-50 hover:border-sky-300"
                  }`}
                  onDragEnter={handleDrag}
                  onDragLeave={handleDrag}
                  onDragOver={handleDrag}
                  onDrop={handleDrop}
                >
                  <input
                    type="file"
                    multiple
                    accept=".jpg,.jpeg,.png,.pdf"
                    className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                    onChange={(e) => e.target.files && void handleFiles(Array.from(e.target.files))}
                  />
                  <div className="flex flex-col items-center space-y-4">
                    <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-sky-100">
                      <UploadIcon className="h-10 w-10 text-sky-700" />
                    </div>
                    <div>
                      <h3 className="text-xl font-semibold text-slate-900">Drop claim files here</h3>
                      <p className="text-sm text-slate-500">Supported formats: JPG, JPEG, PNG, PDF</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {files.length > 0 && (
              <Card className="rounded-3xl border-0 bg-white/90 shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-slate-900">
                    <FileCheck className="h-5 w-5 text-sky-600" />
                    Upload Queue
                  </CardTitle>
                  <CardDescription>Uploaded files remain in review until you approve them.</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {files.map((file) => (
                      <div key={file.id} className="flex items-center space-x-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                        <div className="flex flex-1 items-center space-x-3">
                          {getStatusIcon(file.status)}
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-medium text-slate-900">{file.name}</p>
                            <p className="text-sm text-slate-500">
                              {formatFileSize(file.size)} • {file.type || "image"}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center space-x-4">
                          {(file.status === "queued" || file.status === "extracting") && (
                            <div className="w-24">
                              <Progress value={file.progress} className="h-2" />
                              <p className="mt-1 text-xs text-slate-500">{file.progress}%</p>
                            </div>
                          )}

                          {getStatusBadge(file.status)}

                          {file.extractedData && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="rounded-xl"
                              onClick={() => previewRef.current?.scrollIntoView({ behavior: "smooth" })}
                            >
                              <Eye className="mr-2 h-4 w-4" />
                              Review
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {reviewFiles.length > 0 && (
              <Card ref={previewRef} className="rounded-3xl border-0 bg-white/90 shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-slate-900">
                    <Scan className="h-5 w-5 text-sky-600" />
                    OCR Review Before Save
                  </CardTitle>
                  <CardDescription>
                    Edit any field if needed. Only confirmed records will appear in the database and Atlas.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  {reviewFiles.map((file) => (
                    <div key={file.id} className="space-y-4 rounded-3xl border border-slate-200 bg-slate-50 p-5">
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <h3 className="font-semibold text-slate-900">{file.name}</h3>
                          <p className="text-sm text-slate-500">Review, correct, then confirm this record.</p>
                        </div>
                        <div className="flex items-center gap-3">
                          {getStatusBadge(file.status)}
                          <Button
                            variant="outline"
                            className="rounded-xl"
                            onClick={() => void generateFileCoordinates(file.id)}
                            disabled={generatingFileId === file.id || file.status === "saving" || file.status === "saved"}
                          >
                            <MapPinned className="mr-2 h-4 w-4" />
                            {generatingFileId === file.id ? "Generating..." : "Generate Coordinates"}
                          </Button>
                          <Button
                            className="rounded-xl bg-sky-600 hover:bg-sky-700"
                            onClick={() => void confirmFile(file.id)}
                            disabled={file.status === "saving" || file.status === "saved"}
                          >
                            <Save className="mr-2 h-4 w-4" />
                            {file.status === "saved" ? "Saved" : "Confirm & Save"}
                          </Button>
                        </div>
                      </div>

                      {file.extractedData && renderDocumentForm(
                        file.extractedData,
                        (field, value) => updateFileField(file.id, field, value),
                        fileErrors[file.id] || {},
                      )}

                      {file.savedDocId && (
                        <p className="text-sm text-slate-500">
                          Saved as document ID {file.savedDocId}. Atlas will load it from the database.
                        </p>
                      )}
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="manual" className="space-y-6">
            <Card className="rounded-3xl border-0 bg-white/90 shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-slate-900">
                  <PencilLine className="h-5 w-5 text-sky-600" />
                  Manual Entry
                </CardTitle>
                <CardDescription>
                  Type the claim details, verify them, and save only after confirmation.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <p className="text-sm text-slate-500">
                  Required fields: Claim ID, Applicant / Patta Holder, Village Name, District, State,
                  Claim Type, Total Area Claimed, Land Use, and Date of Application.
                </p>
                {renderDocumentForm(manualDraft, updateManualField, manualErrors)}
                <div className="flex gap-3">
                  <Button className="rounded-xl bg-sky-600 hover:bg-sky-700" onClick={() => void verifyManualDraft()} disabled={manualVerifying}>
                    <Eye className="mr-2 h-4 w-4" />
                    {manualVerifying ? "Detecting Location..." : "Verify Details"}
                  </Button>
                  <Button
                    variant="outline"
                    className="rounded-xl"
                    onClick={() => {
                      setManualDraft(emptyDocument());
                      setManualPreview(null);
                    }}
                  >
                    Reset Form
                  </Button>
                </div>
              </CardContent>
            </Card>

            {manualPreview && (
              <Card ref={manualPreviewRef} className="rounded-3xl border-0 bg-white/90 shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-slate-900">
                    <FileCheck className="h-5 w-5 text-sky-600" />
                    Manual Verification Review
                  </CardTitle>
                  <CardDescription>
                    This record is still pending. Generate coordinates here after reviewing Village, District, and State.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  {renderDocumentForm(
                    manualPreview,
                    (field, value) => {
                      setManualPreview((prev) => (prev ? { ...prev, [field]: value } : prev));
                      setManualPreviewErrors((prev) => ({ ...prev, [field]: undefined }));
                    },
                    manualPreviewErrors,
                  )}
                  <div className="flex gap-3">
                    <Button variant="outline" className="rounded-xl" onClick={() => void generateManualCoordinates()} disabled={manualGenerating}>
                      <MapPinned className="mr-2 h-4 w-4" />
                      {manualGenerating ? "Generating..." : "Generate Coordinates"}
                    </Button>
                    <Button className="rounded-xl bg-sky-600 hover:bg-sky-700" onClick={() => void saveManualDraft()} disabled={manualSaving}>
                      <Save className="mr-2 h-4 w-4" />
                      {manualSaving ? "Saving..." : "Confirm & Save"}
                    </Button>
                    <Button variant="outline" className="rounded-xl" onClick={() => setManualPreview(null)}>
                      Back to Edit
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

export default Upload;
