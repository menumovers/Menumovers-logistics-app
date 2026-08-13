const B = "http://localhost:8080/api";
async function j(method, path, body, headers={}) {
  const r = await fetch(`${B}${path}`, { method, headers: { "content-type":"application/json", ...headers }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: r.status, body: parsed };
}
// Need to seed restaurant + admin + inbound credential via direct DB.
import("@workspace/db").then(async ({ db, restaurantsTable, usersTable, ridersTable, apiCredentialsTable, restaurantExternalIdsTable }) => {
  const bcrypt = (await import("bcryptjs")).default;
  const { createHash, randomBytes } = await import("node:crypto");
  const passwordHash = await bcrypt.hash("password123", 10);
  // Cleanup prior smoke data
  const { eq } = await import("drizzle-orm");
  await db.delete(usersTable).where(eq(usersTable.email, "smoke-admin@x.com"));
  await db.delete(usersTable).where(eq(usersTable.email, "smoke-rider@x.com"));
  const [rest] = await db.insert(restaurantsTable).values({ name:"Smoke Resto", nameCode:`smoke-resto-${Date.now()}`, address:"Hoofdstraat 1", minDeliveryTime:25 }).returning();
  const [admin] = await db.insert(usersTable).values({ email:"smoke-admin@x.com", name:"Admin", passwordHash, role:"admin" }).returning();
  const [riderUser] = await db.insert(usersTable).values({ email:"smoke-rider@x.com", name:"Rider1", passwordHash, role:"rider" }).returning();
  const [rider] = await db.insert(ridersTable).values({ userId: riderUser.id, nameCode:`smoke-rider-${Date.now()}`, availabilityStatus:"online" }).returning();
  const SOURCE = "smoke-source";
  const RAW_SECRET = randomBytes(16).toString("hex");
  await db.insert(apiCredentialsTable).values({
    keyHash: createHash("sha256").update(RAW_SECRET).digest("hex"),
    source: SOURCE,
    status: "active",
  });
  const EXTERNAL_RESTAURANT_ID = "smoke-ext-001";
  await db.insert(restaurantExternalIdsTable).values({
    restaurantId: rest.id,
    source: SOURCE,
    externalId: EXTERNAL_RESTAURANT_ID,
  });
  console.log("Seeded:", { restaurantId: rest.id, adminId: admin.id, riderId: rider.id, source: SOURCE });
  // Login
  const login = await j("POST","/auth/login",{ email:"smoke-admin@x.com", password:"password123" });
  console.log("login:", login.status, login.body.user?.role);
  const token = login.body.token;
  // Ingest
  const orderId = `ext-smoke-${Date.now()}`;
  const ingest = await j("POST","/inbound/orders",{
    orderId, externalRestaurantId: EXTERNAL_RESTAURANT_ID,
    customer: { name:"Klaas", phone:"+31600000001", address:"Kerkstraat 9", street:"Kerkstraat", houseNumber:"9", postalCode:"1012AB", city:"Amsterdam", country:"NL" },
    items: [{ name:"Pizza", quantity:2, price:"12.50"},{name:"Cola",quantity:1,price:"3.00"}],
    deliveryFee:"4.00", totalAmount:"32.00", deliveryInstructions:"Bel aan", tipRider:"1.00", tipRestaurant:"0.50", supTotal:"0.00", statiegeldTotal:"0.00", administrationCosts:"0.35", deliveryMethod:"delivery", paymentMethod:"ideal"
  }, { "x-inbound-secret": RAW_SECRET });
  console.log("ingest:", ingest.status, ingest.body.id, "items:", ingest.body.items?.length, "status:", ingest.body.status, "isParked:", ingest.body.isParked);
  const id = ingest.body.id;
  // Idempotency replay
  const replay = await j("POST","/inbound/orders",{
    orderId, externalRestaurantId: EXTERNAL_RESTAURANT_ID,
    customer: { name:"Klaas", phone:"+31600000001", address:"Kerkstraat 9", street:"Kerkstraat", houseNumber:"9", postalCode:"1012AB", city:"Amsterdam", country:"NL" },
    items: [{name:"Pizza",quantity:2,price:"12.50"}],
    deliveryFee:"4.00", totalAmount:"29.00", tipRider:"1.00", tipRestaurant:"0.50", supTotal:"0.00", statiegeldTotal:"0.00", administrationCosts:"0.35", deliveryMethod:"delivery", paymentMethod:"ideal"
  }, { "x-inbound-secret": RAW_SECRET });
  console.log("replay (same id):", replay.status, replay.body.id, "same:", replay.body.id===id);
  // Unknown external restaurant → parked, not rejected
  const parkedOrderId = `ext-smoke-parked-${Date.now()}`;
  const parked = await j("POST","/inbound/orders",{
    orderId: parkedOrderId, externalRestaurantId: "does-not-exist",
    customer: { name:"Onbekend", phone:"+31600000002", address:"Onbekendstraat 1", street:"Onbekendstraat", houseNumber:"1", postalCode:"1013CD", city:"Amsterdam", country:"NL" },
    items: [{ name:"Broodje", quantity:1, price:"5.00"}],
    deliveryFee:"2.00", totalAmount:"7.00", tipRider:"1.00", tipRestaurant:"0.50", supTotal:"0.00", statiegeldTotal:"0.00", administrationCosts:"0.35", deliveryMethod:"delivery", paymentMethod:"ideal"
  }, { "x-inbound-secret": RAW_SECRET });
  console.log("parked (unknown restaurant, expect 200 + isParked=true):", parked.status, parked.body.isParked, parked.body.parkedReason);
  // Invalid credential → 401
  const badSecret = await j("POST","/inbound/orders",{
    orderId: `ext-smoke-badsecret-${Date.now()}`, externalRestaurantId: EXTERNAL_RESTAURANT_ID,
    customer: { name:"X", phone:"+31600000003", address:"Y", street:"Y", postalCode:"1000AA", city:"Amsterdam", country:"NL" },
    items: [{ name:"Item", quantity:1, price:"1.00"}],
    deliveryFee:"0.00", totalAmount:"1.00", tipRider:"1.00", tipRestaurant:"0.50", supTotal:"0.00", statiegeldTotal:"0.00", administrationCosts:"0.35", deliveryMethod:"delivery", paymentMethod:"ideal"
  }, { "x-inbound-secret": "not-a-real-secret" });
  console.log("bad secret (expect 401):", badSecret.status, badSecret.body.code);
  // List
  const list = await j("GET","/orders", null, { authorization: `Bearer ${token}`});
  console.log("list:", list.status, "count:", list.body.length);
  // Detail
  const detail = await j("GET",`/orders/${id}`, null, { authorization: `Bearer ${token}`});
  console.log("detail:", detail.status, "log entries:", detail.body.statusLog?.length, "effectiveSource:", detail.body.effectivePickupSource);
  // Assign rider
  const assign = await j("POST",`/orders/${id}/assign`,{ riderId: rider.id }, { authorization: `Bearer ${token}`});
  console.log("assign:", assign.status, assign.body.status, "riderId:", assign.body.riderId);
  // Re-assign should 409
  const assignAgain = await j("POST",`/orders/${id}/assign`,{ riderId: rider.id }, { authorization: `Bearer ${token}`});
  console.log("re-assign (expect 409):", assignAgain.status, assignAgain.body.code);
  // Status invalid transition
  const bad = await j("POST",`/orders/${id}/status`,{ toStatus:"delivered" }, { authorization: `Bearer ${token}`});
  console.log("invalid transition (expect 422):", bad.status, bad.body.code);
  // Status valid
  const ok = await j("POST",`/orders/${id}/status`,{ toStatus:"en_route_to_restaurant" }, { authorization: `Bearer ${token}`});
  console.log("transition valid:", ok.status, ok.body.status);
  // Pickup time override
  const pt = await j("POST",`/orders/${id}/pickup-time`,{ source:"override", pickupTime: new Date(Date.now()+45*60000).toISOString()}, { authorization: `Bearer ${token}`});
  console.log("pickup-time override:", pt.status, "source:", pt.body.effectivePickupSource);
  // Hide item
  const hide = await j("POST",`/orders/${id}/items/hide`,{ itemIndex:0 }, { authorization: `Bearer ${token}`});
  console.log("hide item:", hide.status, "items now:", hide.body.items.length);
  // Add item
  const add = await j("POST",`/orders/${id}/items/add`,{ item:{ name:"Frites", quantity:1, price:"3.50"}}, { authorization: `Bearer ${token}`});
  console.log("add item:", add.status, "items now:", add.body.items.length);
  // Notification banner
  const notif = await j("POST",`/orders/${id}/notification`,{ message:"Bel aan bij linkerdeur" }, { authorization: `Bearer ${token}`});
  console.log("notification:", notif.status, "banner:", notif.body.pendingRiderNotification);
  // Contact override
  const contact = await j("POST",`/orders/${id}/contact`,{ deliveryAddress:"Nieuwe Straat 22" }, { authorization: `Bearer ${token}`});
  console.log("contact:", contact.status, "addr:", contact.body.deliveryAddress);
  // Riders list
  const riders = await j("GET","/riders", null, { authorization: `Bearer ${token}`});
  console.log("riders:", riders.status, "count:", riders.body.length, "active:", riders.body.find(r=>r.id===rider.id)?.activeOrderCount);
  process.exit(0);
});
