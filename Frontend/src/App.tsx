import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Layout from "./components/Layout";
import LandingPage from "./components/LandingPage";
import Dashboard from "./pages/Dashboard";
import Atlas from "./pages/AtlasEnhanced";
import Upload from "./pages/Upload";
import Support from "./pages/Support";
import SupportDetail from "./pages/SupportDetail";
import NotFound from "./pages/NotFound";
import ProtectedRoute from "./components/ProtectedRoute";
import { AuthProvider } from "@/hooks/use-auth";
import Login from "./pages/Login";
import Signup from "./pages/Signup";


const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Layout />}>
              <Route index element={<LandingPage />} />
              <Route element={<ProtectedRoute />}>
                <Route path="dashboard" element={<Dashboard />} />
                <Route path="atlas" element={<Atlas />} />
                <Route path="upload" element={<Upload />} />
                <Route path="support" element={<Support />} />
                <Route path="support/:applicantId" element={<SupportDetail />} />
              </Route>
              <Route path="login" element={<Login />} />
              <Route path="signup" element={<Signup />} />
            </Route>
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
