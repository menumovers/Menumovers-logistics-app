import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect } from "react";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import LoginPage from "@/pages/login";
import AdminPage from "@/pages/admin";
import CoordinatorPage from "@/pages/coordinator";
import CoordinatorOrderPage from "@/pages/coordinator-order";
import RiderPage from "@/pages/rider";
import RiderOrderPage from "@/pages/rider-order";
import RestaurantPage from "@/pages/restaurant";
import SettingsPage from "@/pages/settings";
import { AuthProvider, FullScreenLoader, RequireRole, useAuth } from "@/lib/auth";
import { ROLE_HOMES } from "@/lib/role-homes";
import { AppShell } from "@/components/layout";
import { configureApi } from "@/lib/api";
import "@/lib/i18n";

configureApi();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, refetchOnWindowFocus: false },
  },
});

function RootIndex() {
  const { user, isLoading } = useAuth();
  const [, navigate] = useLocation();
  useEffect(() => {
    if (isLoading) return;
    if (user) navigate(ROLE_HOMES[user.role]);
    else navigate("/login");
  }, [user, isLoading, navigate]);
  return <FullScreenLoader />;
}

function Routes() {
  return (
    <Switch>
      <Route path="/login" component={LoginPage} />
      <Route path="/admin">
        <RequireRole roles={["admin"]}><AppShell><AdminPage /></AppShell></RequireRole>
      </Route>
      <Route path="/coordinator">
        <RequireRole roles={["admin", "coordinator"]}><AppShell><CoordinatorPage /></AppShell></RequireRole>
      </Route>
      <Route path="/coordinator/orders/:id">
        <RequireRole roles={["admin", "coordinator"]}><AppShell><CoordinatorOrderPage /></AppShell></RequireRole>
      </Route>
      <Route path="/rider">
        <RequireRole roles={["rider"]}><AppShell><RiderPage /></AppShell></RequireRole>
      </Route>
      <Route path="/rider/orders/:id">
        <RequireRole roles={["rider"]}><AppShell><RiderOrderPage /></AppShell></RequireRole>
      </Route>
      <Route path="/restaurant">
        <RequireRole roles={["restaurant_staff"]}><AppShell><RestaurantPage /></AppShell></RequireRole>
      </Route>
      <Route path="/settings">
        <RequireRole roles={["admin", "coordinator", "rider", "restaurant_staff"]}><AppShell><SettingsPage /></AppShell></RequireRole>
      </Route>
      <Route path="/" component={RootIndex} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <AuthProvider>
            <Routes />
          </AuthProvider>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
