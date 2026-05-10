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
import { Check, Eye, FileCheck, FileText, PencilLine, Save, Scan, Upload as UploadIcon, X } from "lucide-react";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "http://127.0.0.1:8000";

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
  date_of_application: string;
  water_bodies: string;
  forest_cover: string;
  homestead: string;
};

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
  date_of_application: "",
  water_bodies: "",
  forest_cover: "",
  homestead: "",
});

const fieldConfig: Array<{ key: keyof DocumentFormData; label: string; multiline?: boolean }> = [
  { key: "patta_holder_name", label: "Applicant / Patta Holder" },
  { key: "father_or_husband_name", label: "Father / Husband Name" },
  { key: "age", label: "Age" },
  { key: "gender", label: "Gender" },
  { key: "address", label: "Address", multiline: true },
  { key: "village_name", label: "Village Name" },
  { key: "block", label: "Block / Tehsil" },
  { key: "district", label: "District" },
  { key: "state", label: "State" },
  { key: "total_area_claimed", label: "Total Area Claimed" },
  { key: "coordinates", label: "Coordinates" },
  { key: "land_use", label: "Land Use" },
  { key: "claim_id", label: "Claim ID" },
  { key: "date_of_application", label: "Date of Application" },
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

const UploadReview = () => {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [manualDraft, setManualDraft] = useState<DocumentFormData>(emptyDocument());
  const [manualPreview, setManualPreview] = useState<DocumentFormData | null>(null);
  const [manualSaving, setManualSaving] = useState(false);
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

      const res = await fetch(`${BACKEND_URL}/upload/`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        throw new Error("Document extraction failed");
      }

      const raw = await res.json();
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
    const res = await fetch(`${BACKEND_URL}/upload/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      throw new Error("Save failed");
    }

    return res.json();
  };

  const confirmFile = async (fileId: string) => {
    const currentFile = files.find((file) => file.id === fileId);
    if (!currentFile?.extractedData) {
      return;
    }

    try {
      setFiles((prev) =>
        prev.map((file) => (file.id === fileId ? { ...file, status: "saving" } : file))
      );

      const saved = await saveDocument(currentFile.extractedData);
      const normalized = normalizeKeys(saved.data);

      setFiles((prev) =>
        prev.map((file) =>
          file.id === fileId
            ? { ...file, status: "saved", extractedData: normalized, savedDocId: saved.doc_id }
            : file
        )
      );

      toast({
        title: "Saved to database",
        description: `${currentFile.name} is now available in Atlas.`,
      });
    } catch (error) {
      console.error(error);
      setFiles((prev) =>
        prev.map((file) => (file.id === fileId ? { ...file, status: "error" } : file))
      );

      toast({
        title: "Save failed",
        description: `${currentFile.name} could not be stored in the database.`,
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
  };

  const updateManualField = (field: keyof DocumentFormData, value: string) => {
    setManualDraft((prev) => ({ ...prev, [field]: value }));
    setManualPreview(null);
  };

  const verifyManualDraft = () => {
    setManualPreview({ ...manualDraft });
    toast({
      title: "Manual review ready",
      description: "Verify the details below before saving to the database.",
    });
    manualPreviewRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const saveManualDraft = async () => {
    if (!manualPreview) {
      return;
    }

    try {
      setManualSaving(true);
      await saveDocument(manualPreview);
      setManualDraft(emptyDocument());
      setManualPreview(null);
      toast({
        title: "Manual entry saved",
        description: "The verified record is now available in Atlas.",
      });
    } catch (error) {
      console.error(error);
      toast({
        title: "Save failed",
        description: "The manual entry could not be stored in the database.",
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
  ) => (
    <div className="grid gap-4 md:grid-cols-2">
      {fieldConfig.map((field) => (
        <div key={field.key} className={field.multiline ? "space-y-2 md:col-span-2" : "space-y-2"}>
          <Label htmlFor={field.key}>{field.label}</Label>
          {field.multiline ? (
            <Textarea
              id={field.key}
              value={data[field.key]}
              onChange={(e) => onFieldChange(field.key, e.target.value)}
              rows={3}
            />
          ) : (
            <Input
              id={field.key}
              value={data[field.key]}
              onChange={(e) => onFieldChange(field.key, e.target.value)}
            />
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
    <div className="fra-container py-8">
      <div className="mx-auto max-w-5xl">
        <div className="mb-8">
          <h1 className="mb-2 text-3xl font-bold">Document Intake & Verification</h1>
          <p className="text-muted-foreground">
            Extract or enter FRA details first, verify them, and only then save them to the database and Atlas.
          </p>
        </div>

        <Tabs defaultValue="upload" className="space-y-6">
          <TabsList>
            <TabsTrigger value="upload">Upload Image</TabsTrigger>
            <TabsTrigger value="manual">Manual Entry</TabsTrigger>
          </TabsList>

          <TabsContent value="upload" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <UploadIcon className="h-5 w-5" />
                  Upload for OCR Review
                </CardTitle>
                <CardDescription>
                  Upload the image, review the extracted fields, then confirm before it is saved or shown on the map.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div
                  className={`relative rounded-lg border-2 border-dashed p-8 text-center transition-colors ${
                    dragActive ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
                  }`}
                  onDragEnter={handleDrag}
                  onDragLeave={handleDrag}
                  onDragOver={handleDrag}
                  onDrop={handleDrop}
                >
                  <input
                    type="file"
                    multiple
                    accept=".jpg,.jpeg,.png"
                    className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                    onChange={(e) => e.target.files && void handleFiles(Array.from(e.target.files))}
                  />

                  <div className="flex flex-col items-center space-y-4">
                    <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
                      <UploadIcon className="h-8 w-8 text-primary" />
                    </div>
                    <div>
                      <h3 className="text-lg font-semibold">Drop image files here</h3>
                      <p className="text-muted-foreground">Supported now: JPG, JPEG, PNG</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {files.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <FileCheck className="h-5 w-5" />
                    Upload Queue
                  </CardTitle>
                  <CardDescription>
                    Records stay in review until you explicitly save them.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {files.map((file) => (
                      <div key={file.id} className="flex items-center space-x-4 rounded-lg border p-4">
                        <div className="flex flex-1 items-center space-x-3">
                          {getStatusIcon(file.status)}
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-medium">{file.name}</p>
                            <p className="text-sm text-muted-foreground">
                              {formatFileSize(file.size)} • {file.type || "image"}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center space-x-4">
                          {(file.status === "queued" || file.status === "extracting") && (
                            <div className="w-24">
                              <Progress value={file.progress} className="h-2" />
                              <p className="mt-1 text-xs text-muted-foreground">{file.progress}%</p>
                            </div>
                          )}

                          {getStatusBadge(file.status)}

                          {file.extractedData && (
                            <Button
                              size="sm"
                              variant="outline"
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
              <Card ref={previewRef}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Scan className="h-5 w-5" />
                    OCR Review Before Save
                  </CardTitle>
                  <CardDescription>
                    Edit any field if needed. Only saved records will appear in the database and Atlas.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  {reviewFiles.map((file) => (
                    <div key={file.id} className="space-y-4 rounded-lg border p-4">
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <h3 className="font-semibold">{file.name}</h3>
                          <p className="text-sm text-muted-foreground">
                            Review, correct, then confirm this record.
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          {getStatusBadge(file.status)}
                          <Button
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
                      )}

                      {file.savedDocId && (
                        <p className="text-sm text-muted-foreground">
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
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <PencilLine className="h-5 w-5" />
                  Manual Entry
                </CardTitle>
                <CardDescription>
                  Type the details manually, verify them, and then save the verified record.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {renderDocumentForm(manualDraft, updateManualField)}
                <div className="flex gap-3">
                  <Button onClick={verifyManualDraft}>
                    <Eye className="mr-2 h-4 w-4" />
                    Verify Details
                  </Button>
                  <Button
                    variant="outline"
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
              <Card ref={manualPreviewRef}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <FileCheck className="h-5 w-5" />
                    Manual Verification Review
                  </CardTitle>
                  <CardDescription>
                    This record will only be stored after you confirm it below.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  {renderDocumentForm(manualPreview, (field, value) =>
                    setManualPreview((prev) => (prev ? { ...prev, [field]: value } : prev))
                  )}
                  <div className="flex gap-3">
                    <Button onClick={() => void saveManualDraft()} disabled={manualSaving}>
                      <Save className="mr-2 h-4 w-4" />
                      {manualSaving ? "Saving..." : "Confirm & Save"}
                    </Button>
                    <Button variant="outline" onClick={() => setManualPreview(null)}>
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

export default UploadReview;
