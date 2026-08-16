import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListUsers, useCreateUser, useUpdateUser, useDeleteUser,
  useListRestaurants, useCreateRestaurant, useUpdateRestaurant, useDeleteRestaurant,
  useListRiders, useCreateRider, useUpdateRider,
  useGetSettings, useUpdateSettings,
  getListUsersQueryKey, getListRestaurantsQueryKey, getListRidersQueryKey, getGetSettingsQueryKey,
  UserRole, RiderAvailability, RestaurantAcceptanceMode,
  type Restaurant, type RiderWithWorkload, type User as ApiUser, type UserRole as UserRoleType,
  type RiderAvailability as RiderAvailabilityType, type Settings as ApiSettings,
  type RestaurantAcceptanceMode as RestaurantAcceptanceModeType,
} from "@workspace/api-client-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Plus, Trash2, CheckCircle2, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatDateTime } from "@/lib/format";

export default function AdminPage() {
  const { t } = useTranslation();
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold tracking-tight">{t("admin.title")}</h1>
      <Tabs defaultValue="users">
        <TabsList>
          <TabsTrigger value="users" data-testid="tab-users">{t("admin.users")}</TabsTrigger>
          <TabsTrigger value="restaurants" data-testid="tab-restaurants">{t("admin.restaurants")}</TabsTrigger>
          <TabsTrigger value="riders" data-testid="tab-riders">{t("admin.riders")}</TabsTrigger>
          <TabsTrigger value="settings" data-testid="tab-settings">{t("admin.settings")}</TabsTrigger>
        </TabsList>
        <TabsContent value="users" className="mt-4"><UsersPanel /></TabsContent>
        <TabsContent value="restaurants" className="mt-4"><RestaurantsPanel /></TabsContent>
        <TabsContent value="riders" className="mt-4"><RidersPanel /></TabsContent>
        <TabsContent value="settings" className="mt-4"><SettingsPanel /></TabsContent>
      </Tabs>
    </div>
  );
}

function UsersPanel() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const users = useListUsers({ query: { queryKey: getListUsersQueryKey() } });
  const restaurants = useListRestaurants({ query: { queryKey: getListRestaurantsQueryKey() } });
  const create = useCreateUser();
  const updateUser = useUpdateUser();
  const del = useDeleteUser();

  const [form, setForm] = useState({ email: "", name: "", password: "", role: "coordinator" as UserRoleType, restaurantId: "" });
  function invalidate() { qc.invalidateQueries({ queryKey: getListUsersQueryKey() }); }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Plus className="size-4" />{t("admin.newUser")}</CardTitle></CardHeader>
        <CardContent>
          <form
            className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end"
            onSubmit={(e) => {
              e.preventDefault();
              if (!form.email || !form.password || !form.name) return;
              create.mutate(
                {
                  data: {
                    email: form.email, name: form.name, password: form.password, role: form.role,
                    restaurantId: form.role === "restaurant_staff" ? form.restaurantId || null : null,
                  },
                },
                {
                  onSuccess: () => {
                    setForm({ email: "", name: "", password: "", role: "coordinator", restaurantId: "" });
                    toast({ title: t("admin.newUser") });
                    invalidate();
                  },
                  onError: () => toast({ title: t("errors.generic"), variant: "destructive" }),
                },
              );
            }}
          >
            <div><Label className="text-xs">{t("common.name")}</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required data-testid="input-new-user-name" /></div>
            <div><Label className="text-xs">{t("common.email")}</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required data-testid="input-new-user-email" /></div>
            <div><Label className="text-xs">{t("common.password")}</Label><Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={8} data-testid="input-new-user-password" /></div>
            <div>
              <Label className="text-xs">{t("common.role")}</Label>
              <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v as UserRoleType })}>
                <SelectTrigger data-testid="select-new-user-role"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.values(UserRole).map((r) => (
                    <SelectItem key={r} value={r}>{t(`roles.${r}`)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {form.role === "restaurant_staff" ? (
              <div>
                <Label className="text-xs">{t("nav.restaurant")}</Label>
                <Select value={form.restaurantId} onValueChange={(v) => setForm({ ...form, restaurantId: v })}>
                  <SelectTrigger data-testid="select-new-user-restaurant"><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    {(restaurants.data ?? []).map((r) => (<SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
            ) : <div />}
            <div className="md:col-span-5"><Button type="submit" disabled={create.isPending} data-testid="button-create-user">{t("common.create")}</Button></div>
          </form>
        </CardContent>
      </Card>

      <div className="grid gap-3">
        {(users.data ?? []).map((u: ApiUser) => (
          <Card key={u.id} data-testid={`row-user-${u.id}`}>
            <CardContent className="py-3 flex flex-wrap items-center gap-3">
              <div className="flex-1 min-w-[200px]">
                <div className="font-medium">{u.name}</div>
                <div className="text-xs text-muted-foreground">{u.email} · {t(`roles.${u.role}`)}</div>
              </div>
              <Select
                value={u.accountStatus}
                onValueChange={(v) =>
                  updateUser.mutate(
                    { id: u.id, data: { accountStatus: v as ApiUser["accountStatus"] } },
                    { onSuccess: invalidate },
                  )
                }
              >
                <SelectTrigger className="w-32" data-testid={`select-user-status-${u.id}`}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">{t("common.yes")}</SelectItem>
                  <SelectItem value="suspended">{t("common.no")}</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => del.mutate({ id: u.id }, { onSuccess: invalidate })}
                data-testid={`button-delete-user-${u.id}`}
              >
                <Trash2 className="size-4" />
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function RestaurantsPanel() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const restaurants = useListRestaurants({ query: { queryKey: getListRestaurantsQueryKey() } });
  const create = useCreateRestaurant();
  const update = useUpdateRestaurant();
  const del = useDeleteRestaurant();
  const { toast } = useToast();

  const [form, setForm] = useState({ name: "", nameCode: "", address: "", phone: "", minDeliveryTime: 30 });
  function invalidate() { qc.invalidateQueries({ queryKey: getListRestaurantsQueryKey() }); }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Plus className="size-4" />{t("admin.newRestaurant")}</CardTitle></CardHeader>
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
                    invalidate();
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
      </Card>
      <div className="grid gap-3">
        {(restaurants.data ?? []).map((r: Restaurant) => (
          <RestaurantRow key={r.id} restaurant={r} onUpdate={update.mutate} onInvalidate={invalidate} onDelete={() => del.mutate({ id: r.id }, { onSuccess: invalidate })} />
        ))}
      </div>
    </div>
  );
}

function RestaurantRow({ restaurant, onUpdate, onInvalidate, onDelete }: { restaurant: Restaurant; onUpdate: ReturnType<typeof useUpdateRestaurant>["mutate"]; onInvalidate: () => void; onDelete: () => void }) {
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
    <Card data-testid={`row-restaurant-${restaurant.id}`}>
      <CardContent className="py-3 grid grid-cols-1 md:grid-cols-6 gap-2 items-end">
        <div className="md:col-span-2"><Label className="text-xs">{t("common.name")}</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div><Label className="text-xs">{t("admin.nameCode")}</Label><Input value={nameCode} onChange={(e) => setNameCode(e.target.value)} data-testid={`input-rest-name-code-${restaurant.id}`} /></div>
        <div className="md:col-span-2"><Label className="text-xs">{t("common.address")}</Label><Input value={addr} onChange={(e) => setAddr(e.target.value)} /></div>
        <div><Label className="text-xs">{t("common.phone")}</Label><Input value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
        <div><Label className="text-xs">{t("admin.minDeliveryTime")}</Label><Input type="number" min={1} value={mdt} onChange={(e) => setMdt(Number(e.target.value))} /></div>
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
            data-testid={`button-update-restaurant-${restaurant.id}`}
          >
            {t("common.save")}
          </Button>
          <Button variant="ghost" size="icon" onClick={onDelete} data-testid={`button-delete-restaurant-${restaurant.id}`}>
            <Trash2 className="size-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function RidersPanel() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const riders = useListRiders({ query: { queryKey: getListRidersQueryKey() } });
  const create = useCreateRider();
  const update = useUpdateRider();
  const { toast } = useToast();

  const [form, setForm] = useState({ name: "", nameCode: "", email: "", password: "", phone: "", availabilityStatus: "online" as RiderAvailabilityType });
  function invalidate() { qc.invalidateQueries({ queryKey: getListRidersQueryKey() }); }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Plus className="size-4" />{t("admin.newRider")}</CardTitle></CardHeader>
        <CardContent>
          <form
            className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end"
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate(
                { data: { name: form.name, nameCode: form.nameCode, email: form.email, password: form.password, phone: form.phone || null, availabilityStatus: form.availabilityStatus } },
                {
                  onSuccess: () => {
                    setForm({ name: "", nameCode: "", email: "", password: "", phone: "", availabilityStatus: "online" });
                    toast({ title: t("admin.newRider") });
                    invalidate();
                  },
                  onError: () => toast({ title: t("errors.generic"), variant: "destructive" }),
                },
              );
            }}
          >
            <div><Label className="text-xs">{t("common.name")}</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required data-testid="input-new-rider-name" /></div>
            <div><Label className="text-xs">{t("admin.nameCode")}</Label><Input value={form.nameCode} onChange={(e) => setForm({ ...form, nameCode: e.target.value })} required data-testid="input-new-rider-name-code" /></div>
            <div><Label className="text-xs">{t("common.email")}</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required data-testid="input-new-rider-email" /></div>
            <div><Label className="text-xs">{t("common.password")}</Label><Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={8} data-testid="input-new-rider-password" /></div>
            <div><Label className="text-xs">{t("common.phone")}</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} data-testid="input-new-rider-phone" /></div>
            <div>
              <Label className="text-xs">{t("rider.availability")}</Label>
              <Select value={form.availabilityStatus} onValueChange={(v) => setForm({ ...form, availabilityStatus: v as RiderAvailabilityType })}>
                <SelectTrigger data-testid="select-new-rider-avail"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.values(RiderAvailability).map((a) => <SelectItem key={a} value={a}>{t(`availability.${a}`)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button type="submit" disabled={create.isPending} data-testid="button-create-rider">{t("common.create")}</Button>
          </form>
        </CardContent>
      </Card>

      <div className="grid gap-3">
        {(riders.data ?? []).map((r: RiderWithWorkload) => (
          <RiderRow key={r.id} rider={r} onUpdate={update.mutate} onInvalidate={invalidate} />
        ))}
      </div>
    </div>
  );
}

function RiderRow({ rider: r, onUpdate, onInvalidate }: { rider: RiderWithWorkload; onUpdate: ReturnType<typeof useUpdateRider>["mutate"]; onInvalidate: () => void }) {
  const { t } = useTranslation();
  const [nameCode, setNameCode] = useState(r.nameCode);
  const nameDirty = nameCode !== r.nameCode;
  return (
    <Card data-testid={`row-rider-${r.id}`}>
      <CardContent className="py-3 flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[200px]">
          <div className="font-medium">{r.name}</div>
          <div className="text-xs text-muted-foreground">{r.nameCode} · {r.email}{r.phone ? ` · ${r.phone}` : ""} · {r.activeOrderCount}+{r.queuedOrderCount}</div>
        </div>
        <div className="flex items-end gap-2">
          <div>
            <Label className="text-xs">{t("admin.nameCode")}</Label>
            <Input value={nameCode} onChange={(e) => setNameCode(e.target.value)} className="w-32" data-testid={`input-rider-name-code-${r.id}`} />
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={!nameDirty}
            onClick={() => onUpdate({ id: r.id, data: { nameCode } }, { onSuccess: onInvalidate })}
            data-testid={`button-update-rider-name-code-${r.id}`}
          >
            {t("common.save")}
          </Button>
        </div>
        <Select
          value={r.availabilityStatus}
          onValueChange={(v) =>
            onUpdate(
              { id: r.id, data: { availabilityStatus: v as RiderAvailabilityType } },
              { onSuccess: onInvalidate },
            )
          }
        >
          <SelectTrigger className="w-36" data-testid={`select-rider-avail-${r.id}`}><SelectValue /></SelectTrigger>
          <SelectContent>
            {Object.values(RiderAvailability).map((a) => <SelectItem key={a} value={a}>{t(`availability.${a}`)}</SelectItem>)}
          </SelectContent>
        </Select>
      </CardContent>
    </Card>
  );
}

/**
 * The two pickup estimates (D13).
 *
 * `default` is our baseline: every scheduled order works back from it, and an
 * ASAP order falls back to it only when the payload carried no minimum pickup
 * time. `inTheMoment` is today's conditions, entered in absolute terms and
 * applying to ASAP orders only — it clears itself at 03:00 Amsterdam, so it
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

  const storedDefault = String(settings.pickupEstimateDefaultMinutes);
  const storedMoment =
    settings.pickupEstimateInTheMomentMinutes == null
      ? ""
      : String(settings.pickupEstimateInTheMomentMinutes);
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
          <Label className="text-xs" htmlFor="pickup-estimate-default">
            {t("admin.pickupEstimateDefault")}
          </Label>
          <div className="flex items-center gap-2">
            <Input
              id="pickup-estimate-default"
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              className="w-32 tabular-nums"
              value={defaultValue}
              onChange={(e) => setDefaultDraft(e.target.value)}
              data-testid="input-pickup-estimate-default"
            />
            <Button
              disabled={update.isPending || defaultValue === storedDefault}
              onClick={() => {
                const minutes = parseMinutes(defaultValue);
                // The baseline has no "unset" — clearing it would leave every
                // scheduled order without a figure to work back from.
                if (minutes == null) return;
                save({ pickupEstimateDefaultMinutes: minutes });
              }}
              data-testid="button-save-pickup-estimate-default"
            >
              {t("common.save")}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{t("admin.pickupEstimateDefaultHelp")}</p>
        </div>

        <div className="space-y-2 border-t border-border pt-4">
          <Label className="text-xs" htmlFor="pickup-estimate-moment">
            {t("admin.pickupEstimateInTheMoment")}
          </Label>
          <div className="flex items-center gap-2">
            <Input
              id="pickup-estimate-moment"
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              placeholder={storedDefault}
              className="w-32 tabular-nums"
              value={momentValue}
              onChange={(e) => setMomentDraft(e.target.value)}
              data-testid="input-pickup-estimate-moment"
            />
            <Button
              disabled={update.isPending || momentValue === storedMoment}
              onClick={() => {
                const minutes = parseMinutes(momentValue);
                if (minutes === undefined) return;
                save({ pickupEstimateInTheMomentMinutes: minutes });
              }}
              data-testid="button-save-pickup-estimate-moment"
            >
              {t("common.save")}
            </Button>
            {settings.pickupEstimateInTheMomentMinutes != null ? (
              <Button
                variant="ghost"
                disabled={update.isPending}
                onClick={() => save({ pickupEstimateInTheMomentMinutes: null })}
                data-testid="button-clear-pickup-estimate-moment"
              >
                {t("admin.pickupEstimateInTheMomentClear")}
              </Button>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">
            {t("admin.pickupEstimateInTheMomentHelp")}
          </p>
          {settings.pickupEstimateInTheMomentMinutes != null ? (
            <p
              className="text-xs text-accent-foreground"
              data-testid="text-pickup-estimate-moment-active"
            >
              {t("admin.pickupEstimateInTheMomentActive", {
                minutes: settings.pickupEstimateInTheMomentMinutes,
                time: settings.pickupEstimateInTheMomentSetAt
                  ? formatDateTime(settings.pickupEstimateInTheMomentSetAt, lang)
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
      {settings.data ? <PickupTimingCard settings={settings.data} /> : null}
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
    </div>
  );
}
