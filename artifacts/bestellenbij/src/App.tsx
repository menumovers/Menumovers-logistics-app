import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import LandingPage from "@/pages/landing";
import LoginPage from "@/pages/login";
import AdminPage from "@/pages/admin";
import CoordinatorPage from "@/pages/coordinator";
import CoordinatorOrderPage from "@/pages/coordinator-order";
import OrderReceiptPage from "@/pages/order-receipt";
import CoordinatorTripBuilderPage from "@/pages/coordinator-trip-builder";
import CoordinatorTripPage from "@/pages/coordinator-trip";
import RiderPage from "@/pages/rider";
import RiderOrderPage from "@/pages/rider-order";
import RiderTripPage from "@/pages/rider-trip";
import RestaurantPage from "@/pages/restaurant";
import SettingsPage from "@/pages/settings";
import { AuthProvider, RequireRole } from "@/lib/auth";
import { AppShell } from "@/components/layout";
import { configureApi } from "@/lib/api";
import "@/lib/i18n";

configureApi();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, refetchOnWindowFocus: false },
  },
});

function Routes() {
  return (
    <Switch>
      <Route path="/rider/login">
        <LoginPage variant="rider" />
      </Route>
      <Route path="/restaurant/login">
        <LoginPage variant="restaurant" />
      </Route>
      <Route path="/login">
        {/* Legacy generic login — keep working by defaulting to rider. */}
        <LoginPage variant="rider" />
      </Route>
      <Route path="/admin">
        <RequireRole roles={["admin"]}><AppShell><AdminPage /></AppShell></RequireRole>
      </Route>
      <Route path="/coordinator">
        <RequireRole roles={["admin", "coordinator"]}><AppShell><CoordinatorPage /></AppShell></RequireRole>
      </Route>
      <Route path="/orders/:id/receipt">
        <RequireRole roles={["admin", "coordinator", "restaurant_staff"]}><AppShell><OrderReceiptPage /></AppShell></RequireRole>
      </Route>
      <Route path="/coordinator/orders/:id">
        <RequireRole roles={["admin", "coordinator"]}><AppShell><CoordinatorOrderPage /></AppShell></RequireRole>
      </Route>
      <Route path="/coordinator/trips/new">
        <RequireRole roles={["admin", "coordinator"]}><AppShell><CoordinatorTripBuilderPage /></AppShell></RequireRole>
      </Route>
      <Route path="/coordinator/trips/:id">
        <RequireRole roles={["admin", "coordinator"]}><AppShell><CoordinatorTripPage /></AppShell></RequireRole>
      </Route>
      <Route path="/rider">
        <RequireRole roles={["admin", "coordinator", "rider"]}><AppShell><RiderPage /></AppShell></RequireRole>
      </Route>
      <Route path="/rider/orders/:id">
        <RequireRole roles={["admin", "coordinator", "rider"]}><AppShell><RiderOrderPage /></AppShell></RequireRole>
      </Route>
      <Route path="/rider/trips/:id">
        <RequireRole roles={["admin", "coordinator", "rider"]}><AppShell><RiderTripPage /></AppShell></RequireRole>
      </Route>
      <Route path="/restaurant">
        <RequireRole roles={["admin", "restaurant_staff"]}><AppShell><RestaurantPage /></AppShell></RequireRole>
      </Route>
      <Route path="/settings">
        <RequireRole roles={["admin", "coordinator", "rider", "restaurant_staff"]}><AppShell><SettingsPage /></AppShell></RequireRole>
      </Route>
      <Route path="/" component={LandingPage} />
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
