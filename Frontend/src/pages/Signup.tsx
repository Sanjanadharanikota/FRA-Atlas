import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";

const Signup = () => {
  const { signup } = useAuth();
  const navigate = useNavigate();
  const location = useLocation() as { state?: { from?: { pathname?: string } } };
  const { toast } = useToast();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const from = location.state?.from?.pathname || "/dashboard";

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await signup(name, email, password);
      toast({ title: "Account created", description: `Welcome, ${name || "User"}.` });
      navigate(from, { replace: true });
    } catch (err: any) {
      const message = err?.message || "Failed to sign up";
      setError(message);
      toast({ title: "Signup failed", description: message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fra-container py-10">
      <div className="mx-auto max-w-md">
        <Card>
          <CardHeader>
            <CardTitle>Create account</CardTitle>
            <CardDescription>Sign up to start using FRA Atlas</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="space-y-4">
              <div>
                <label className="text-sm font-medium">Name</label>
                <Input type="text" value={name} onChange={(e) => setName(e.target.value)} required />
              </div>
              <div>
                <label className="text-sm font-medium">Email</label>
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </div>
              <div>
                <label className="text-sm font-medium">Password</label>
                <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Creating..." : "Create account"}
              </Button>
            </form>
            <p className="mt-3 text-sm text-muted-foreground">
              Already have an account?{" "}
              <Link to="/login" className="text-primary">
                Login
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Signup;
