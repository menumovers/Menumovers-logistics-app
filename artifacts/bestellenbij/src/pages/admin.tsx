import { Fragment, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  useListUsers, useCreateUser, useUpdateUser, useDeleteUser,
  useListRestaurants, useCreateRestaurant, useUpdateRestaurant, useDeleteRestaurant,
  useListRiders, useUpdateRider,
  useGetSettings, useUpdateSettings,
  useListOrders,
  getListUsersQueryKey, getListRestaurantsQueryKey, getListRidersQueryKey, getGetSettingsQueryKey,
  getListOrdersQueryKey,
  UserRole, RiderAvailability, RestaurantAcceptanceMode, OrderStatus,
  type Restaurant, type RiderWithWorkload, type User as ApiUser, type UserRole as UserRoleType,
  type RiderAvailability as RiderAvailabilityType, type Settings as ApiSettings,
  type RestaurantAcceptanceMode as RestaurantAcceptanceModeType, type OrderListItem,
} from "@workspace/api-client-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect } from "@/components/searchable-select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { Plus, Trash2, CheckCircle2, AlertCircle, Filter, SlidersHorizontal, ChevronDown, ChevronRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatDateTime, formatTime, effectivePickup, minutesUntil } from "@/lib/format";
import { RequestedTimeLabel } from "@/components/delivery-expectation";
import { cn } from "@/lib/utils";

export default function AdminPage() {
  const { t } = useTranslation();
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold tracking-tight">{t("admin.title")}</h1>
      <Tabs defaultValue="orders">
        <div className="overflow-x-auto -mx-1 px-1">
          <TabsList className="w-max">
            <TabsTrigger value="orders" data-testid="tab-orders">{t("admin.orders")}</TabsTrigger>
            <TabsTrigger value="riders" data-testid="tab-riders">{t("admin.riders")}</TabsTrigger>
            <TabsTrigger value="restaurants" data-testid="tab-restaurants">{t("admin.restaurants")}</TabsTrigger>
            <TabsTrigger value="users" data-testid="tab-users" aria-label={t("admin.users")} className="px-2 sm:px-3">
              <span className="hidden sm:inline">{t("admin.users")}</span>
              <span className="sm:hidden text-base" aria-hidden="true">👤</span>
            </TabsTrigger>
            <TabsTrigger value="add" data-testid="tab-add" aria-label={t("admin.add")} className="px-2 sm:px-3">
              <span className="hidden sm:inline">{t("admin.add")}</span>
              <span className="sm:hidden font-bold tracking-tighter" aria-hidden="true">+++</span>
            </TabsTrigger>
            <TabsTrigger value="settings" data-testid="tab-settings" aria-label={t("admin.settings")} className="px-2 sm:px-3">
              <span className="hidden sm:inline">{t("admin.settings")}</span>
              <span className="sm:hidden text-base" aria-hidden="true">🔧</span>
            </TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="orders" className="mt-4"><OrdersPanel /></TabsContent>
        <TabsContent value="riders" className="mt-4"><RidersPanel /></TabsContent>
        <TabsContent value="restaurants" className="mt-4"><RestaurantsPanel /></TabsContent>
        <TabsContent value="users" className="mt-4"><UsersPanel /></TabsContent>
        <TabsContent value="add" className="mt-4"><AddPanel /></TabsContent>
        <TabsContent value="settings" className="mt-4"><SettingsPanel /></TabsContent>
      </Tabs>
    </div>
  );
}

const ALL = "__all__";

type SortKey = "pickup" | "delivery" | "createdAsc" | "createdDesc" | "orderNr";

const QUICK_FILTER_KEYS = [
  "active1h",
  "active2h",
  "futureToday",
  "futureAll",
  "completedToday",
  "pastToday",
  "pastAll",
] as const;
type QuickFilterKey = (typeof QUICK_FILTER_KEYS)[number];

function isSameLocalDay(iso: string, reference: Date): boolean {
  const d = new Date(iso);
  return (
    d.getFullYear() === reference.getFullYear() &&
    d.getMonth() === reference.getMonth() &&
    d.getDate() === reference.getDate()
  );
}

/** Quick filters key off the effective pick-up time — the operational timeline used everywhere else in the app. */
function matchesQuickFilter(order: OrderListItem, key: QuickFilterKey, now: Date): boolean {
  const eff = effectivePickup(order);
  const mins = minutesUntil(eff.iso, now);
  const active = order.status !== "delivered" && order.status !== "failed";
  const today = isSameLocalDay(eff.iso, now);
  switch (key) {
    case "active1h": return active && mins <= 60;
    case "active2h": return active && mins <= 120;
    case "futureToday": return mins > 0 && today;
    case "futureAll": return mins > 0;
    case "completedToday": return order.status === "delivered" && today;
    case "pastToday": return mins < 0 && today;
    case "pastAll": return mins < 0;
  }
}

type NameSortKey = "nameAsc" | "nameDesc";

function sortByName<T>(items: T[], sortBy: NameSortKey, getName: (item: T) => string): T[] {
  const arr = [...items];
  arr.sort((a, b) => getName(a).localeCompare(getName(b)));
  if (sortBy === "nameDesc") arr.reverse();
  return arr;
}

function NameSortSelect({ value, onValueChange, testId }: { value: NameSortKey; onValueChange: (v: NameSortKey) => void; testId: string }) {
  const { t } = useTranslation();
  return (
    <Select value={value} onValueChange={(v) => onValueChange(v as NameSortKey)}>
      <SelectTrigger className="w-40" data-testid={testId}><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="nameAsc">{t("admin.sortNameAsc")}</SelectItem>
        <SelectItem value="nameDesc">{t("admin.sortNameDesc")}</SelectItem>
      </SelectContent>
    </Select>
  );
}

const RIDER_STATUS_FILTER_KEYS = ["online", "offline", "backup"] as const;
const RIDER_WORKLOAD_FILTER_KEYS = ["hasActive", "noActive"] as const;
const RIDER_QUICK_FILTER_KEYS = [...RIDER_STATUS_FILTER_KEYS, ...RIDER_WORKLOAD_FILTER_KEYS] as const;
type RiderQuickFilterKey = (typeof RIDER_QUICK_FILTER_KEYS)[number];

/** Status options and workload options are two independent facets — each is OR'd internally, and the two facets are AND'd together. */
function matchesRiderQuickFilters(rider: RiderWithWorkload, quickFilters: Set<RiderQuickFilterKey>): boolean {
  const selectedStatus = RIDER_STATUS_FILTER_KEYS.filter((k) => quickFilters.has(k));
  const selectedWorkload = RIDER_WORKLOAD_FILTER_KEYS.filter((k) => quickFilters.has(k));
  const hasActive = rider.activeOrderCount > 0;
  const statusOk = selectedStatus.length === 0 || selectedStatus.some((k) => rider.availabilityStatus === k);
  const workloadOk =
    selectedWorkload.length === 0 ||
    selectedWorkload.some((k) => (k === "hasActive" ? hasActive : !hasActive));
  return statusOk && workloadOk;
}

function OrdersPanel() {
  const { t, i18n } = useTranslation();
  const lang = i18n.resolvedLanguage ?? "nl";
  const [sortBy, setSortBy] = useState<SortKey>("pickup");
  const [quickFilters, setQuickFilters] = useState<Set<QuickFilterKey>>(new Set());
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [status, setStatus] = useState<string>(ALL);
  const [restaurantId, setRestaurantId] = useState<string>(ALL);
  const [riderId, setRiderId] = useState<string>(ALL);
  const [q, setQ] = useState("");

  const params = useMemo(() => {
    const p: Record<string, string> = {};
    if (status !== ALL) p.status = status;
    if (restaurantId !== ALL) p.restaurantId = restaurantId;
    if (riderId !== ALL) p.riderId = riderId;
    if (q.trim()) p.q = q.trim();
    return p;
  }, [status, restaurantId, riderId, q]);

  const orders = useListOrders(params, {
    query: { queryKey: getListOrdersQueryKey(params), refetchInterval: 30_000 },
  });
  const restaurants = useListRestaurants({ query: { queryKey: getListRestaurantsQueryKey() } });
  const riders = useListRiders({ query: { queryKey: getListRidersQueryKey() } });

  function toggleQuickFilter(key: QuickFilterKey) {
    setQuickFilters((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const sorted = useMemo(() => {
    const all = orders.data ?? [];
    const now = new Date();
    const filtered =
      quickFilters.size === 0
        ? all
        : all.filter((o) => Array.from(quickFilters).some((k) => matchesQuickFilter(o, k, now)));

    const arr = [...filtered];
    switch (sortBy) {
      case "pickup":
        arr.sort((a, b) => new Date(effectivePickup(a).iso).getTime() - new Date(effectivePickup(b).iso).getTime());
        break;
      case "delivery":
        arr.sort((a, b) => new Date(a.requestedDeliveryTime).getTime() - new Date(b.requestedDeliveryTime).getTime());
        break;
      case "createdAsc":
        arr.sort((a, b) => new Date(a.sourceCreatedAt).getTime() - new Date(b.sourceCreatedAt).getTime());
        break;
      case "createdDesc":
        arr.sort((a, b) => new Date(b.sourceCreatedAt).getTime() - new Date(a.sourceCreatedAt).getTime());
        break;
      case "orderNr":
        arr.sort((a, b) => a.externalOrderId.localeCompare(b.externalOrderId, undefined, { numeric: true }));
        break;
    }
    return arr;
  }, [orders.data, quickFilters, sortBy]);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 py-3">
          <Button
            variant="ghost"
            onClick={() => setFiltersOpen((v) => !v)}
            data-testid="button-orders-filters-toggle"
          >
            <SlidersHorizontal className="size-3.5 mr-1.5" />
            {t("admin.ordersFilters")}
            <ChevronDown className={cn("size-3.5 ml-1 transition-transform", filtersOpen && "rotate-180")} />
          </Button>

          <div className="ml-auto text-sm text-muted-foreground tabular-nums" data-testid="text-admin-orders-count">
            {t("coordinator.ordersCount", { count: sorted.length })}
          </div>
        </CardContent>

        {filtersOpen ? (
          <CardContent className="flex flex-wrap items-end gap-3 pt-0 pb-4 border-t border-border">
            <div>
              <Label className="text-xs text-muted-foreground">{t("admin.ordersSort")}</Label>
              <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortKey)}>
                <SelectTrigger className="w-56" data-testid="select-orders-sort"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pickup">{t("admin.ordersSort_pickup")}</SelectItem>
                  <SelectItem value="delivery">{t("admin.ordersSort_delivery")}</SelectItem>
                  <SelectItem value="createdAsc">{t("admin.ordersSort_createdAsc")}</SelectItem>
                  <SelectItem value="createdDesc">{t("admin.ordersSort_createdDesc")}</SelectItem>
                  <SelectItem value="orderNr">{t("admin.ordersSort_orderNr")}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" data-testid="button-orders-quick-filter">
                  <Filter className="size-3.5 mr-1.5" />
                  {t("admin.ordersQuickFilter")}
                  {quickFilters.size > 0 ? ` (${quickFilters.size})` : ""}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {QUICK_FILTER_KEYS.map((key) => (
                  <DropdownMenuCheckboxItem
                    key={key}
                    checked={quickFilters.has(key)}
                    onCheckedChange={() => toggleQuickFilter(key)}
                    onSelect={(e) => e.preventDefault()}
                    data-testid={`checkbox-quick-filter-${key}`}
                  >
                    {t(`admin.ordersQuickFilter_${key}`)}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <Button
              variant="ghost"
              onClick={() => setAdvancedOpen((v) => !v)}
              data-testid="button-orders-advanced-filter-toggle"
            >
              <SlidersHorizontal className="size-3.5 mr-1.5" />
              {t("admin.ordersAdvancedFilter")}
              <ChevronDown className={cn("size-3.5 ml-1 transition-transform", advancedOpen && "rotate-180")} />
            </Button>
          </CardContent>
        ) : null}
      </Card>

      {filtersOpen && advancedOpen ? (
        <Card>
          <CardContent className="grid grid-cols-1 md:grid-cols-4 gap-3 py-4">
            <div>
              <Label className="text-xs text-muted-foreground">{t("common.search")}</Label>
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={t("coordinator.searchPlaceholder")}
                data-testid="input-orders-search"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">{t("coordinator.filterStatus")}</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger data-testid="select-orders-filter-status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>{t("common.all")}</SelectItem>
                  {Object.values(OrderStatus).map((s) => (
                    <SelectItem key={s} value={s}>{t(`orderStatus.${s}`)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">{t("coordinator.filterRestaurant")}</Label>
              <SearchableSelect
                value={restaurantId}
                onValueChange={setRestaurantId}
                options={[
                  { value: ALL, label: t("common.all") },
                  ...(restaurants.data ?? []).map((r) => ({ value: r.id, label: r.name })),
                ]}
                searchPlaceholder={t("common.search")}
                emptyText={t("common.noResults")}
                triggerTestId="select-orders-filter-restaurant"
                itemTestId={(v) => `option-orders-filter-restaurant-${v}`}
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">{t("coordinator.filterRider")}</Label>
              <SearchableSelect
                value={riderId}
                onValueChange={setRiderId}
                options={[
                  { value: ALL, label: t("common.all") },
                  ...(riders.data ?? []).map((r) => ({ value: r.id, label: r.name })),
                ]}
                searchPlaceholder={t("common.search")}
                emptyText={t("common.noResults")}
                triggerTestId="select-orders-filter-rider"
                itemTestId={(v) => `option-orders-filter-rider-${v}`}
              />
            </div>
          </CardContent>
        </Card>
      ) : null}

      {orders.isLoading ? (
        <div className="grid place-items-center py-20"><Spinner className="size-6 text-primary" /></div>
      ) : sorted.length === 0 ? (
        <Card><CardContent className="py-20 text-center text-muted-foreground">{t("coordinator.empty")}</CardContent></Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("admin.ordersColumnNumber")}</TableHead>
                  <TableHead>{t("pickup.label")}</TableHead>
                  <TableHead>{t("admin.ordersColumnDelivery")}</TableHead>
                  <TableHead>{t("nav.restaurant")}</TableHead>
                  <TableHead>{t("common.address")}</TableHead>
                  <TableHead className="text-right">{t("common.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((o) => {
                  const eff = effectivePickup(o);
                  const otherDay = o.deliveryTimeType === "other_day";
                  return (
                    <TableRow key={o.id} data-testid={`row-admin-order-${o.id}`}>
                      <TableCell className="tabular-nums font-medium whitespace-nowrap">
                        <Link
                          href={`/coordinator/orders/${o.id}`}
                          className="hover:underline underline-offset-2"
                          data-testid={`link-admin-order-number-${o.id}`}
                        >
                          #{o.externalOrderId.slice(-5)}
                        </Link>
                      </TableCell>
                      <TableCell className="tabular-nums whitespace-nowrap">
                        {otherDay ? formatDateTime(eff.iso, lang) : formatTime(eff.iso, lang)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap"><RequestedTimeLabel order={o} lang={lang} /></TableCell>
                      <TableCell className="truncate max-w-[180px]">{o.restaurantName ?? "—"}</TableCell>
                      <TableCell className="truncate max-w-[240px]">{o.deliveryAddress}</TableCell>
                      <TableCell className="text-right">
                        <Button asChild variant="outline" size="sm" data-testid={`button-admin-order-detail-${o.id}`}>
                          <Link href={`/coordinator/orders/${o.id}`}>
                            {t("common.details")} <ChevronRight className="size-3.5 ml-1" />
                          </Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function UsersPanel() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const users = useListUsers({ query: { queryKey: getListUsersQueryKey() } });
  const restaurants = useListRestaurants({ query: { queryKey: getListRestaurantsQueryKey() } });
  const riders = useListRiders({ query: { queryKey: getListRidersQueryKey() } });
  const updateUser = useUpdateUser();
  const del = useDeleteUser();

  const [q, setQ] = useState("");
  const [sortBy, setSortBy] = useState<NameSortKey>("nameAsc");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  function invalidate() {
    qc.invalidateQueries({ queryKey: getListUsersQueryKey() });
    qc.invalidateQueries({ queryKey: getListRidersQueryKey() });
  }

  const filtered = useMemo(() => {
    const all = users.data ?? [];
    const needle = q.trim().toLowerCase();
    const matching = needle
      ? all.filter((u) => u.name.toLowerCase().includes(needle) || u.email.toLowerCase().includes(needle))
      : all;
    return sortByName(matching, sortBy, (u) => u.name);
  }, [users.data, q, sortBy]);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 py-3">
          <div className="flex-1 min-w-[180px]">
            <Label className="text-xs text-muted-foreground">{t("common.search")}</Label>
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("common.search")} data-testid="input-users-search" />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">{t("common.sortBy")}</Label>
            <NameSortSelect value={sortBy} onValueChange={setSortBy} testId="select-users-sort" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("common.name")}</TableHead>
                <TableHead>{t("common.type")}</TableHead>
                <TableHead className="text-right">{t("common.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((u: ApiUser) => (
                <Fragment key={u.id}>
                  <TableRow data-testid={`row-user-${u.id}`}>
                    <TableCell className="font-medium">
                      {u.name}
                      {u.accountStatus === "suspended" ? (
                        <span className="ml-2 text-xs font-normal text-muted-foreground">({t("common.disabled")})</span>
                      ) : null}
                    </TableCell>
                    <TableCell>{u.roles.map((r) => t(`roles.${r}`)).join(", ")}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setExpandedId((cur) => (cur === u.id ? null : u.id))}
                        data-testid={`button-toggle-user-${u.id}`}
                      >
                        {t("common.details")}
                        <ChevronDown className={cn("size-3.5 ml-1 transition-transform", expandedId === u.id && "rotate-180")} />
                      </Button>
                    </TableCell>
                  </TableRow>
                  {expandedId === u.id ? (
                    <TableRow>
                      <TableCell colSpan={3} className="bg-muted/30">
                        <UserEditForm
                          user={u}
                          restaurants={restaurants.data ?? []}
                          existingRider={(riders.data ?? []).find((r) => r.userId === u.id) ?? null}
                          onUpdate={updateUser.mutate}
                          onInvalidate={invalidate}
                          onDelete={() => del.mutate({ id: u.id }, { onSuccess: invalidate })}
                        />
                      </TableCell>
                    </TableRow>
                  ) : null}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function rolesEqual(a: UserRoleType[], b: UserRoleType[]): boolean {
  if (a.length !== b.length) return false;
  const bSet = new Set(b);
  return a.every((r) => bSet.has(r));
}

function UserEditForm({
  user,
  restaurants,
  existingRider,
  onUpdate,
  onInvalidate,
  onDelete,
}: {
  user: ApiUser;
  restaurants: Restaurant[];
  existingRider: RiderWithWorkload | null;
  onUpdate: ReturnType<typeof useUpdateUser>["mutate"];
  onInvalidate: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [roles, setRoles] = useState<UserRoleType[]>(user.roles);
  const [restaurantId, setRestaurantId] = useState(user.restaurantId ?? "");
  const [riderNameCode, setRiderNameCode] = useState("");
  const [riderPhone, setRiderPhone] = useState("");
  const [riderAvailability, setRiderAvailability] = useState<RiderAvailabilityType>("offline");
  const isActive = user.accountStatus === "active";
  const wantsRestaurant = roles.includes("restaurant_staff");
  const wantsRider = roles.includes("rider");
  const needsNewRiderProfile = wantsRider && !existingRider;
  const dirty =
    name !== user.name ||
    email !== user.email ||
    !rolesEqual(roles, user.roles) ||
    (wantsRestaurant && restaurantId !== (user.restaurantId ?? ""));
  const canSave = dirty && (!needsNewRiderProfile || riderNameCode.trim().length > 0);

  function save() {
    onUpdate(
      {
        id: user.id,
        data: {
          name,
          email,
          roles,
          restaurantId: wantsRestaurant ? restaurantId || null : null,
          riderProfile: needsNewRiderProfile
            ? { nameCode: riderNameCode, phone: riderPhone || null, availabilityStatus: riderAvailability }
            : undefined,
        },
      },
      { onSuccess: onInvalidate, onError: () => toast({ title: t("errors.generic"), variant: "destructive" }) },
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end py-2">
      <div><Label className="text-xs">{t("common.name")}</Label><Input value={name} onChange={(e) => setName(e.target.value)} data-testid={`input-user-name-${user.id}`} /></div>
      <div><Label className="text-xs">{t("common.email")}</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} data-testid={`input-user-email-${user.id}`} /></div>
      <div className="md:col-span-2">
        <Label className="text-xs">{t("common.role")}</Label>
        <ToggleGroup
          type="multiple"
          variant="outline"
          value={roles}
          onValueChange={(v) => setRoles(v as UserRoleType[])}
          className="flex-wrap justify-start"
          data-testid={`toggle-user-roles-${user.id}`}
        >
          {Object.values(UserRole).map((r) => (
            <ToggleGroupItem key={r} value={r} data-testid={`toggle-user-role-${user.id}-${r}`}>
              {t(`roles.${r}`)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      {wantsRestaurant ? (
        <div>
          <Label className="text-xs">{t("nav.restaurant")}</Label>
          <SearchableSelect
            value={restaurantId}
            onValueChange={setRestaurantId}
            options={restaurants.map((r) => ({ value: r.id, label: r.name }))}
            searchPlaceholder={t("common.search")}
            emptyText={t("common.noResults")}
            triggerTestId={`select-user-restaurant-${user.id}`}
          />
        </div>
      ) : null}
      {needsNewRiderProfile ? (
        <>
          <div><Label className="text-xs">{t("admin.nameCode")}</Label><Input value={riderNameCode} onChange={(e) => setRiderNameCode(e.target.value)} required data-testid={`input-user-rider-name-code-${user.id}`} /></div>
          <div><Label className="text-xs">{t("common.phone")}</Label><Input value={riderPhone} onChange={(e) => setRiderPhone(e.target.value)} data-testid={`input-user-rider-phone-${user.id}`} /></div>
          <div>
            <Label className="text-xs">{t("rider.availability")}</Label>
            <Select value={riderAvailability} onValueChange={(v) => setRiderAvailability(v as RiderAvailabilityType)}>
              <SelectTrigger data-testid={`select-user-rider-avail-${user.id}`}><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.values(RiderAvailability).map((a) => <SelectItem key={a} value={a}>{t(`availability.${a}`)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </>
      ) : null}
      {wantsRider && existingRider ? (
        <div className="md:col-span-2 text-xs text-muted-foreground">{t("admin.riderProfileInRidersTab")}</div>
      ) : null}
      <div className="md:col-span-4 flex justify-end gap-2">
        <Button variant="outline" disabled={!canSave} onClick={save} data-testid={`button-save-user-${user.id}`}>
          {t("common.save")}
        </Button>
        <Button
          variant="outline"
          onClick={() => onUpdate({ id: user.id, data: { accountStatus: isActive ? "suspended" : "active" } }, { onSuccess: onInvalidate })}
          data-testid={`button-toggle-status-user-${user.id}`}
        >
          {isActive ? t("common.disable") : t("common.enable")}
        </Button>
        <Button variant="ghost" size="icon" onClick={onDelete} data-testid={`button-delete-user-${user.id}`}>
          <Trash2 className="size-4" />
        </Button>
      </div>
    </div>
  );
}

function RestaurantsPanel() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const restaurants = useListRestaurants({ query: { queryKey: getListRestaurantsQueryKey() } });
  const update = useUpdateRestaurant();
  const del = useDeleteRestaurant();

  const [q, setQ] = useState("");
  const [sortBy, setSortBy] = useState<NameSortKey>("nameAsc");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  function invalidate() { qc.invalidateQueries({ queryKey: getListRestaurantsQueryKey() }); }

  const filtered = useMemo(() => {
    // The "unmapped" placeholder isn't a real restaurant to manage — it's what
    // unresolved orders get attributed to until a coordinator sorts them out.
    const all = (restaurants.data ?? []).filter((r) => r.nameCode !== "unmapped");
    const needle = q.trim().toLowerCase();
    const matching = needle
      ? all.filter((r) => r.name.toLowerCase().includes(needle) || r.nameCode.toLowerCase().includes(needle) || r.address.toLowerCase().includes(needle))
      : all;
    return sortByName(matching, sortBy, (r) => r.name);
  }, [restaurants.data, q, sortBy]);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 py-3">
          <div className="flex-1 min-w-[180px]">
            <Label className="text-xs text-muted-foreground">{t("common.search")}</Label>
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("common.search")} data-testid="input-restaurants-search" />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">{t("common.sortBy")}</Label>
            <NameSortSelect value={sortBy} onValueChange={setSortBy} testId="select-restaurants-sort" />
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("common.name")}</TableHead>
                <TableHead>{t("admin.nameCode")}</TableHead>
                <TableHead className="text-right">{t("common.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((r: Restaurant) => (
                <Fragment key={r.id}>
                  <TableRow data-testid={`row-restaurant-${r.id}`}>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell>{r.nameCode}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setExpandedId((cur) => (cur === r.id ? null : r.id))}
                        data-testid={`button-toggle-restaurant-${r.id}`}
                      >
                        {t("common.details")}
                        <ChevronDown className={cn("size-3.5 ml-1 transition-transform", expandedId === r.id && "rotate-180")} />
                      </Button>
                    </TableCell>
                  </TableRow>
                  {expandedId === r.id ? (
                    <TableRow>
                      <TableCell colSpan={3} className="bg-muted/30">
                        <RestaurantEditForm restaurant={r} onUpdate={update.mutate} onInvalidate={invalidate} onDelete={() => del.mutate({ id: r.id }, { onSuccess: invalidate })} />
                      </TableCell>
                    </TableRow>
                  ) : null}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function RestaurantEditForm({ restaurant, onUpdate, onInvalidate, onDelete }: { restaurant: Restaurant; onUpdate: ReturnType<typeof useUpdateRestaurant>["mutate"]; onInvalidate: () => void; onDelete: () => void }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [name, setName] = useState(restaurant.name);
  const [nameCode, setNameCode] = useState(restaurant.nameCode);
  const [addr, setAddr] = useState(restaurant.address);
  const [phone, setPhone] = useState(restaurant.phone ?? "");
  const [mdt, setMdt] = useState(restaurant.minDeliveryTime);
  const [mode, setMode] = useState<RestaurantAcceptanceModeType>(restaurant.acceptanceMode);
  const dirty = name !== restaurant.name || nameCode !== restaurant.nameCode || addr !== restaurant.address || phone !== (restaurant.phone ?? "") || mdt !== restaurant.minDeliveryTime || mode !== restaurant.acceptanceMode;
  return (
    <div className="grid grid-cols-1 md:grid-cols-6 gap-3 items-end py-2">
      <div className="md:col-span-2"><Label className="text-xs">{t("common.name")}</Label><Input value={name} onChange={(e) => setName(e.target.value)} data-testid={`input-rest-name-${restaurant.id}`} /></div>
      <div><Label className="text-xs">{t("admin.nameCode")}</Label><Input value={nameCode} onChange={(e) => setNameCode(e.target.value)} data-testid={`input-rest-name-code-${restaurant.id}`} /></div>
      <div className="md:col-span-2"><Label className="text-xs">{t("common.address")}</Label><Input value={addr} onChange={(e) => setAddr(e.target.value)} data-testid={`input-rest-address-${restaurant.id}`} /></div>
      <div><Label className="text-xs">{t("common.phone")}</Label><Input value={phone} onChange={(e) => setPhone(e.target.value)} data-testid={`input-rest-phone-${restaurant.id}`} /></div>
      <div><Label className="text-xs">{t("admin.minDeliveryTime")}</Label><Input type="number" min={1} value={mdt} onChange={(e) => setMdt(Number(e.target.value))} data-testid={`input-rest-min-delivery-${restaurant.id}`} /></div>
      <div className="md:col-span-2">
        <Label className="text-xs">{t("admin.acceptanceMode")}</Label>
        <Select value={mode} onValueChange={(v) => setMode(v as RestaurantAcceptanceModeType)}>
          <SelectTrigger data-testid={`select-acceptance-mode-${restaurant.id}`}><SelectValue /></SelectTrigger>
          <SelectContent>
            {Object.values(RestaurantAcceptanceMode).map((m) => (
              <SelectItem key={m} value={m}>{t(`admin.acceptanceMode_${m}`)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="md:col-span-6 text-xs text-muted-foreground -mt-1">
        {t("admin.acceptanceModeHelp")}
      </div>
      <div className="md:col-span-6 flex justify-end gap-2">
        <Button
          variant="outline"
          disabled={!dirty}
          onClick={() => onUpdate({ id: restaurant.id, data: { name, nameCode, address: addr, phone: phone || null, minDeliveryTime: mdt, acceptanceMode: mode } }, { onSuccess: onInvalidate, onError: () => toast({ title: t("errors.generic"), variant: "destructive" }) })}
          data-testid={`button-save-restaurant-${restaurant.id}`}
        >
          {t("common.save")}
        </Button>
        <Button variant="ghost" size="icon" onClick={onDelete} data-testid={`button-delete-restaurant-${restaurant.id}`}>
          <Trash2 className="size-4" />
        </Button>
      </div>
    </div>
  );
}

function RidersPanel() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const riders = useListRiders({ query: { queryKey: getListRidersQueryKey() } });
  const update = useUpdateRider();

  const [q, setQ] = useState("");
  const [sortBy, setSortBy] = useState<NameSortKey>("nameAsc");
  const [quickFilters, setQuickFilters] = useState<Set<RiderQuickFilterKey>>(new Set());
  const [expandedId, setExpandedId] = useState<string | null>(null);
  function invalidate() { qc.invalidateQueries({ queryKey: getListRidersQueryKey() }); }

  function toggleQuickFilter(key: RiderQuickFilterKey) {
    setQuickFilters((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const filtered = useMemo(() => {
    const all = riders.data ?? [];
    const needle = q.trim().toLowerCase();
    const searched = needle
      ? all.filter((r) => r.name.toLowerCase().includes(needle) || r.nameCode.toLowerCase().includes(needle) || r.email.toLowerCase().includes(needle))
      : all;
    const matching = quickFilters.size === 0 ? searched : searched.filter((r) => matchesRiderQuickFilters(r, quickFilters));
    return sortByName(matching, sortBy, (r) => r.name);
  }, [riders.data, q, sortBy, quickFilters]);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 py-3">
          <div className="flex-1 min-w-[180px]">
            <Label className="text-xs text-muted-foreground">{t("common.search")}</Label>
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("common.search")} data-testid="input-riders-search" />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">{t("common.sortBy")}</Label>
            <NameSortSelect value={sortBy} onValueChange={setSortBy} testId="select-riders-sort" />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground block mb-1.5">&nbsp;</Label>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" data-testid="button-riders-quick-filter">
                  <Filter className="size-3.5 mr-1.5" />
                  {t("admin.ridersQuickFilter")}
                  {quickFilters.size > 0 ? ` (${quickFilters.size})` : ""}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {RIDER_STATUS_FILTER_KEYS.map((key) => (
                  <DropdownMenuCheckboxItem
                    key={key}
                    checked={quickFilters.has(key)}
                    onCheckedChange={() => toggleQuickFilter(key)}
                    onSelect={(e) => e.preventDefault()}
                    data-testid={`checkbox-riders-quick-filter-${key}`}
                  >
                    {t(`availability.${key}`)}
                  </DropdownMenuCheckboxItem>
                ))}
                <DropdownMenuSeparator />
                {RIDER_WORKLOAD_FILTER_KEYS.map((key) => (
                  <DropdownMenuCheckboxItem
                    key={key}
                    checked={quickFilters.has(key)}
                    onCheckedChange={() => toggleQuickFilter(key)}
                    onSelect={(e) => e.preventDefault()}
                    data-testid={`checkbox-riders-quick-filter-${key}`}
                  >
                    {t(`admin.ridersQuickFilter_${key}`)}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("common.name")}</TableHead>
                <TableHead>{t("admin.nameCode")}</TableHead>
                <TableHead className="text-right">{t("common.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((r: RiderWithWorkload) => (
                <Fragment key={r.id}>
                  <TableRow data-testid={`row-rider-${r.id}`}>
                    <TableCell className="font-medium">
                      {r.name}
                      {r.accountStatus === "suspended" ? (
                        <span className="ml-2 text-xs font-normal text-muted-foreground">({t("common.disabled")})</span>
                      ) : null}
                    </TableCell>
                    <TableCell>{r.nameCode}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setExpandedId((cur) => (cur === r.id ? null : r.id))}
                        data-testid={`button-toggle-rider-${r.id}`}
                      >
                        {t("common.details")}
                        <ChevronDown className={cn("size-3.5 ml-1 transition-transform", expandedId === r.id && "rotate-180")} />
                      </Button>
                    </TableCell>
                  </TableRow>
                  {expandedId === r.id ? (
                    <TableRow>
                      <TableCell colSpan={3} className="bg-muted/30">
                        <RiderEditForm rider={r} onUpdate={update.mutate} onInvalidate={invalidate} />
                      </TableCell>
                    </TableRow>
                  ) : null}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// Rider-specific operational fields only (nameCode/phone/availability).
// Account-level fields (email, password, roles, active/suspended) are
// managed from the Users tab — see UserEditForm.
function RiderEditForm({ rider: r, onUpdate, onInvalidate }: { rider: RiderWithWorkload; onUpdate: ReturnType<typeof useUpdateRider>["mutate"]; onInvalidate: () => void }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [nameCode, setNameCode] = useState(r.nameCode);
  const [phone, setPhone] = useState(r.phone ?? "");
  const [availability, setAvailability] = useState<RiderAvailabilityType>(r.availabilityStatus);
  const dirty = nameCode !== r.nameCode || phone !== (r.phone ?? "") || availability !== r.availabilityStatus;

  function save() {
    onUpdate(
      { id: r.id, data: { nameCode, phone: phone || null, availabilityStatus: availability } },
      { onSuccess: onInvalidate, onError: () => toast({ title: t("errors.generic"), variant: "destructive" }) },
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end py-2">
      <div><Label className="text-xs">{t("common.name")}</Label><Input value={r.name} disabled data-testid={`input-rider-name-${r.id}`} /></div>
      <div><Label className="text-xs">{t("admin.nameCode")}</Label><Input value={nameCode} onChange={(e) => setNameCode(e.target.value)} data-testid={`input-rider-name-code-${r.id}`} /></div>
      <div><Label className="text-xs">{t("common.email")}</Label><Input value={r.email} disabled data-testid={`input-rider-email-${r.id}`} /></div>
      <div><Label className="text-xs">{t("common.phone")}</Label><Input value={phone} onChange={(e) => setPhone(e.target.value)} data-testid={`input-rider-phone-${r.id}`} /></div>
      <div>
        <Label className="text-xs">{t("rider.availability")}</Label>
        <Select value={availability} onValueChange={(v) => setAvailability(v as RiderAvailabilityType)}>
          <SelectTrigger data-testid={`select-rider-avail-${r.id}`}><SelectValue /></SelectTrigger>
          <SelectContent>
            {Object.values(RiderAvailability).map((a) => <SelectItem key={a} value={a}>{t(`availability.${a}`)}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="md:col-span-3 text-xs text-muted-foreground">
        {t("coordinator.workloadActive")}: {r.activeOrderCount} · {t("coordinator.workloadQueued")}: {r.queuedOrderCount}
      </div>
      <div className="md:col-span-4 flex justify-end gap-2">
        <Button variant="outline" disabled={!dirty} onClick={save} data-testid={`button-save-rider-${r.id}`}>
          {t("common.save")}
        </Button>
      </div>
    </div>
  );
}

function AddPanel() {
  return (
    <div className="space-y-4">
      <AddUserCard />
      <AddRestaurantCard />
    </div>
  );
}

const DEFAULT_NEW_USER_FORM = {
  email: "",
  name: "",
  password: "",
  roles: ["coordinator"] as UserRoleType[],
  restaurantId: "",
  riderNameCode: "",
  riderPhone: "",
  riderAvailability: "offline" as RiderAvailabilityType,
};

function AddUserCard() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const restaurants = useListRestaurants({ query: { queryKey: getListRestaurantsQueryKey() } });
  const create = useCreateUser();

  const [form, setForm] = useState(DEFAULT_NEW_USER_FORM);
  const [formOpen, setFormOpen] = useState(false);
  const wantsRestaurant = form.roles.includes("restaurant_staff");
  const wantsRider = form.roles.includes("rider");
  const canSubmit =
    form.email && form.password && form.name && (!wantsRider || form.riderNameCode.trim().length > 0);

  return (
    <Card>
      <CardHeader>
        <button
          type="button"
          className="flex items-center justify-between w-full text-left"
          onClick={() => setFormOpen((v) => !v)}
          data-testid="button-toggle-new-user"
        >
          <CardTitle className="text-base flex items-center gap-2"><Plus className="size-4" />{t("admin.newUser")}</CardTitle>
          <ChevronDown className={cn("size-4 transition-transform", formOpen && "rotate-180")} />
        </button>
      </CardHeader>
      {formOpen ? (
      <CardContent>
        <form
          className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end"
          onSubmit={(e) => {
            e.preventDefault();
            if (!canSubmit) return;
            create.mutate(
              {
                data: {
                  email: form.email,
                  name: form.name,
                  password: form.password,
                  roles: form.roles,
                  restaurantId: wantsRestaurant ? form.restaurantId || null : null,
                  riderProfile: wantsRider
                    ? { nameCode: form.riderNameCode, phone: form.riderPhone || null, availabilityStatus: form.riderAvailability }
                    : undefined,
                },
              },
              {
                onSuccess: () => {
                  setForm(DEFAULT_NEW_USER_FORM);
                  toast({ title: t("admin.newUser") });
                  qc.invalidateQueries({ queryKey: getListUsersQueryKey() });
                  qc.invalidateQueries({ queryKey: getListRidersQueryKey() });
                },
                onError: () => toast({ title: t("errors.generic"), variant: "destructive" }),
              },
            );
          }}
        >
          <div><Label className="text-xs">{t("common.name")}</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required data-testid="input-new-user-name" /></div>
          <div><Label className="text-xs">{t("common.email")}</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required data-testid="input-new-user-email" /></div>
          <div><Label className="text-xs">{t("common.password")}</Label><Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={8} data-testid="input-new-user-password" /></div>
          <div className="md:col-span-2">
            <Label className="text-xs">{t("common.role")}</Label>
            <ToggleGroup
              type="multiple"
              variant="outline"
              value={form.roles}
              onValueChange={(v) => setForm({ ...form, roles: v as UserRoleType[] })}
              className="flex-wrap justify-start"
              data-testid="toggle-new-user-roles"
            >
              {Object.values(UserRole).map((r) => (
                <ToggleGroupItem key={r} value={r} data-testid={`toggle-new-user-role-${r}`}>
                  {t(`roles.${r}`)}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
          {wantsRestaurant ? (
            <div>
              <Label className="text-xs">{t("nav.restaurant")}</Label>
              <SearchableSelect
                value={form.restaurantId}
                onValueChange={(v) => setForm({ ...form, restaurantId: v })}
                options={(restaurants.data ?? []).map((r) => ({ value: r.id, label: r.name }))}
                searchPlaceholder={t("common.search")}
                emptyText={t("common.noResults")}
                triggerTestId="select-new-user-restaurant"
              />
            </div>
          ) : null}
          {wantsRider ? (
            <>
              <div><Label className="text-xs">{t("admin.nameCode")}</Label><Input value={form.riderNameCode} onChange={(e) => setForm({ ...form, riderNameCode: e.target.value })} required data-testid="input-new-user-rider-name-code" /></div>
              <div><Label className="text-xs">{t("common.phone")}</Label><Input value={form.riderPhone} onChange={(e) => setForm({ ...form, riderPhone: e.target.value })} data-testid="input-new-user-rider-phone" /></div>
              <div>
                <Label className="text-xs">{t("rider.availability")}</Label>
                <Select value={form.riderAvailability} onValueChange={(v) => setForm({ ...form, riderAvailability: v as RiderAvailabilityType })}>
                  <SelectTrigger data-testid="select-new-user-rider-avail"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.values(RiderAvailability).map((a) => <SelectItem key={a} value={a}>{t(`availability.${a}`)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </>
          ) : null}
          <div className="md:col-span-5"><Button type="submit" disabled={create.isPending || !canSubmit} data-testid="button-create-user">{t("common.create")}</Button></div>
        </form>
      </CardContent>
      ) : null}
    </Card>
  );
}

function AddRestaurantCard() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const create = useCreateRestaurant();

  const [form, setForm] = useState({ name: "", nameCode: "", address: "", phone: "", minDeliveryTime: 30 });
  const [formOpen, setFormOpen] = useState(false);

  return (
    <Card>
      <CardHeader>
        <button
          type="button"
          className="flex items-center justify-between w-full text-left"
          onClick={() => setFormOpen((v) => !v)}
          data-testid="button-toggle-new-restaurant"
        >
          <CardTitle className="text-base flex items-center gap-2"><Plus className="size-4" />{t("admin.newRestaurant")}</CardTitle>
          <ChevronDown className={cn("size-4 transition-transform", formOpen && "rotate-180")} />
        </button>
      </CardHeader>
      {formOpen ? (
      <CardContent>
        <form
          className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate(
              {
                data: {
                  name: form.name, nameCode: form.nameCode, address: form.address,
                  phone: form.phone || null,
                  minDeliveryTime: Math.max(1, Number(form.minDeliveryTime) || 30),
                },
              },
              {
                onSuccess: () => {
                  setForm({ name: "", nameCode: "", address: "", phone: "", minDeliveryTime: 30 });
                  toast({ title: t("admin.newRestaurant") });
                  qc.invalidateQueries({ queryKey: getListRestaurantsQueryKey() });
                },
                onError: () => toast({ title: t("errors.generic"), variant: "destructive" }),
              },
            );
          }}
        >
          <div className="md:col-span-2"><Label className="text-xs">{t("common.name")}</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required data-testid="input-new-rest-name" /></div>
          <div><Label className="text-xs">{t("admin.nameCode")}</Label><Input value={form.nameCode} onChange={(e) => setForm({ ...form, nameCode: e.target.value })} required data-testid="input-new-rest-name-code" /></div>
          <div className="md:col-span-2"><Label className="text-xs">{t("common.address")}</Label><Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} required data-testid="input-new-rest-address" /></div>
          <div><Label className="text-xs">{t("common.phone")}</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} data-testid="input-new-rest-phone" /></div>
          <div className="md:col-span-2"><Label className="text-xs">{t("admin.minDeliveryTime")}</Label><Input type="number" min={1} value={form.minDeliveryTime} onChange={(e) => setForm({ ...form, minDeliveryTime: Number(e.target.value) })} data-testid="input-new-rest-min-delivery" /></div>
          <Button type="submit" disabled={create.isPending} data-testid="button-create-restaurant">{t("common.create")}</Button>
        </form>
      </CardContent>
      ) : null}
    </Card>
  );
}


/**
 * The two pickup settings (D13).
 *
 * Two different quantities with two different anchors. `pickupOffset` counts
 * **backwards from the delivery time** and applies to every order.
 * `pickupWithin` counts **forwards from the order arriving** — "it's quiet, we
 * can be there in ten" — and when set it simply is the ASAP pickup time. They
 * never combine. ASAP only, and it clears itself at 03:00 Amsterdam so it
 * cannot quietly govern tomorrow.
 */
function PickupTimingCard({ settings }: { settings: ApiSettings }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.resolvedLanguage ?? "nl";
  const qc = useQueryClient();
  const update = useUpdateSettings();
  const { toast } = useToast();

  const [defaultDraft, setDefaultDraft] = useState<string | null>(null);
  const [momentDraft, setMomentDraft] = useState<string | null>(null);

  const storedDefault = String(settings.pickupOffsetMinutes);
  const storedMoment =
    settings.pickupWithinMinutes == null
      ? ""
      : String(settings.pickupWithinMinutes);
  const defaultValue = defaultDraft ?? storedDefault;
  const momentValue = momentDraft ?? storedMoment;

  function save(data: Parameters<typeof update.mutate>[0]["data"]) {
    update.mutate(
      { data },
      {
        onSuccess: (fresh) => {
          setDefaultDraft(null);
          setMomentDraft(null);
          toast({ title: t("admin.settingsSaved") });
          qc.setQueryData(getGetSettingsQueryKey(), fresh);
        },
        onError: () => toast({ title: t("errors.generic"), variant: "destructive" }),
      },
    );
  }

  function parseMinutes(raw: string): number | null | undefined {
    const trimmed = raw.trim();
    if (trimmed === "") return null;
    const minutes = Number.parseInt(trimmed, 10);
    if (!Number.isInteger(minutes) || minutes < 0) return undefined;
    return minutes;
  }

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{t("admin.pickupTiming")}</CardTitle></CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <Label className="text-xs" htmlFor="pickup-offset">
            {t("admin.pickupOffset")}
          </Label>
          <div className="flex items-center gap-2">
            <Input
              id="pickup-offset"
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              className="w-32 tabular-nums"
              value={defaultValue}
              onChange={(e) => setDefaultDraft(e.target.value)}
              data-testid="input-pickup-offset"
            />
            <Button
              disabled={update.isPending || defaultValue === storedDefault}
              onClick={() => {
                const minutes = parseMinutes(defaultValue);
                // The offset has no "unset" — clearing it would leave every
                // order without a gap to work back from.
                if (minutes == null) return;
                save({ pickupOffsetMinutes: minutes });
              }}
              data-testid="button-save-pickup-offset"
            >
              {t("common.save")}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{t("admin.pickupOffsetHelp")}</p>
        </div>

        <div className="space-y-2 border-t border-border pt-4">
          <Label className="text-xs" htmlFor="pickup-within">
            {t("admin.pickupWithin")}
          </Label>
          <div className="flex items-center gap-2">
            <Input
              id="pickup-within"
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              placeholder={storedDefault}
              className="w-32 tabular-nums"
              value={momentValue}
              onChange={(e) => setMomentDraft(e.target.value)}
              data-testid="input-pickup-within"
            />
            <Button
              disabled={update.isPending || momentValue === storedMoment}
              onClick={() => {
                const minutes = parseMinutes(momentValue);
                if (minutes === undefined) return;
                save({ pickupWithinMinutes: minutes });
              }}
              data-testid="button-save-pickup-within"
            >
              {t("common.save")}
            </Button>
            {settings.pickupWithinMinutes != null ? (
              <Button
                variant="ghost"
                disabled={update.isPending}
                onClick={() => save({ pickupWithinMinutes: null })}
                data-testid="button-clear-pickup-within"
              >
                {t("admin.pickupWithinClear")}
              </Button>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">
            {t("admin.pickupWithinHelp")}
          </p>
          {settings.pickupWithinMinutes != null ? (
            <p
              className="text-xs text-accent-foreground"
              data-testid="text-pickup-within-active"
            >
              {t("admin.pickupWithinActive", {
                minutes: settings.pickupWithinMinutes,
                time: settings.pickupWithinSetAt
                  ? formatDateTime(settings.pickupWithinSetAt, lang)
                  : "—",
              })}
            </p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function SettingsPanel() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const settings = useGetSettings({ query: { queryKey: getGetSettingsQueryKey() } });
  const update = useUpdateSettings();
  const { toast } = useToast();
  const [url, setUrl] = useState("");
  const [touched, setTouched] = useState(false);
  const value = touched ? url : settings.data?.outboundWebhookUrl ?? "";
  return (
    <div className="space-y-4 max-w-2xl">
      {settings.data ? <PickupTimingCard settings={settings.data} /> : null}
      {settings.data ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("admin.dispatchPolicy")}</CardTitle>
          </CardHeader>
          <CardContent className="py-2 space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="allow-rider-self-claim" className="text-sm">
                  {t("admin.allowRiderSelfClaim")}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {t("admin.allowRiderSelfClaimHelp")}
                </p>
              </div>
              <Switch
                id="allow-rider-self-claim"
                checked={settings.data.allowRiderSelfClaim}
                disabled={update.isPending}
                onCheckedChange={(checked) =>
                  update.mutate(
                    { data: { allowRiderSelfClaim: checked } },
                    {
                      onSuccess: (data) => {
                        toast({ title: t("admin.settingsSaved") });
                        qc.setQueryData(getGetSettingsQueryKey(), data);
                      },
                    },
                  )
                }
                data-testid="switch-allow-rider-self-claim"
              />
            </div>
          </CardContent>
        </Card>
      ) : null}
      {settings.data ? (
        <Card>
          <CardContent className="py-4 space-y-2 text-sm">
            <div className="flex items-center gap-2" data-testid="status-vapid">
              {settings.data.vapidConfigured ? <CheckCircle2 className="size-4 text-chart-5" /> : <AlertCircle className="size-4 text-destructive" />}
              {t("admin.vapidConfigured")}
            </div>
            <div className="flex items-center gap-2" data-testid="status-inbound">
              {settings.data.inboundSecretConfigured ? <CheckCircle2 className="size-4 text-chart-5" /> : <AlertCircle className="size-4 text-destructive" />}
              {t("admin.inboundConfigured")}
            </div>
          </CardContent>
        </Card>
      ) : null}
      <Card>
        <CardHeader><CardTitle className="text-base">{t("admin.outboundWebhook")}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <Label className="text-xs">{t("admin.outboundWebhook")}</Label>
          <Input
            value={value}
            onChange={(e) => { setTouched(true); setUrl(e.target.value); }}
            placeholder={t("admin.outboundWebhookPlaceholder")}
            data-testid="input-outbound-webhook"
          />
          <p className="text-xs text-muted-foreground">{t("admin.outboundWebhookHelp")}</p>
          {settings.data ? (
            <p className="text-xs text-muted-foreground">
              {t("admin.outboundSource")}: {t(`admin.outboundSource_${settings.data.outboundWebhookUrlSource}`)}
            </p>
          ) : null}
          {settings.data ? (
            <div className="flex items-center justify-between gap-4 border-t border-border pt-3">
              <div className="space-y-0.5">
                <Label htmlFor="outbound-webhook-enabled" className="text-sm">
                  {t("admin.outboundWebhookEnabled")}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {t("admin.outboundWebhookEnabledHelp")}
                </p>
              </div>
              <Switch
                id="outbound-webhook-enabled"
                checked={settings.data.outboundWebhookEnabled}
                disabled={update.isPending}
                onCheckedChange={(checked) =>
                  update.mutate(
                    { data: { outboundWebhookEnabled: checked } },
                    {
                      onSuccess: (data) => {
                        toast({ title: t("admin.settingsSaved") });
                        qc.setQueryData(getGetSettingsQueryKey(), data);
                      },
                    },
                  )
                }
                data-testid="switch-outbound-webhook-enabled"
              />
            </div>
          ) : null}
          <Button
            disabled={update.isPending || !touched}
            onClick={() =>
              update.mutate(
                { data: { outboundWebhookUrl: url || null } },
                {
                  onSuccess: (data) => {
                    setTouched(false);
                    toast({ title: t("admin.settingsSaved") });
                    qc.setQueryData(getGetSettingsQueryKey(), data);
                  },
                },
              )
            }
            data-testid="button-save-settings"
          >
            {t("common.save")}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
