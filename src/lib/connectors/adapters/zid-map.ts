/**
 * Zid → ZYRONEX normalization.
 *
 * Pure mapping only. No business logic, no AI, no decisions — the connector
 * layer turns Zid's payload shapes into the same neutral shapes the rest of
 * ZYRONEX (workflows, CRM, agents) already consumes for every other commerce
 * provider.
 */

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function str(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function num(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

/** Zid money is either a scalar or `{ amount, currency }` / `{ value, currency }`. */
function amount(value: unknown, fallbackCurrency?: unknown): { amount: number | null; currency: string | null } {
  const source = record(value);
  const raw = source["amount"] ?? source["value"] ?? value;
  return {
    amount: num(raw),
    currency: str(source["currency"]) ?? str(fallbackCurrency),
  };
}

export type NormalizedZidCustomer = {
  object: "customer";
  source: "zid";
  id: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  country: string | null;
};

export type NormalizedZidProduct = {
  object: "product";
  source: "zid";
  id: string | null;
  name: string | null;
  sku: string | null;
  status: string | null;
  price: { amount: number | null; currency: string | null };
  quantity: number | null;
  unlimited_quantity: boolean;
  url: string | null;
};

export type NormalizedZidOrder = {
  object: "order";
  source: "zid";
  id: string | null;
  reference: string | null;
  status: string | null;
  payment_method: string | null;
  placed_at: string | null;
  total: { amount: number | null; currency: string | null };
  customer: NormalizedZidCustomer | null;
  shipping: {
    method: string | null;
    tracking_number: string | null;
    address: { country: string | null; city: string | null; street: string | null; postal_code: string | null } | null;
  };
  items: {
    id: string | null;
    product_id: string | null;
    name: string | null;
    sku: string | null;
    quantity: number | null;
    price: { amount: number | null; currency: string | null };
  }[];
  store_id: string | null;
  raw_id: string | null;
};

/** Zid localizes several fields as `{ ar, en }`. */
function localized(value: unknown): string | null {
  const source = record(value);
  return str(source["en"]) ?? str(source["ar"]) ?? str(source["name"]) ?? str(value);
}

export function normalizeZidCustomer(input: unknown): NormalizedZidCustomer | null {
  const source = record(input);
  if (Object.keys(source).length === 0) return null;
  const mobile = str(source["mobile"]) ?? str(source["phone"]);
  const code = str(source["mobile_country_code"]) ?? str(source["country_code"]);
  const name = str(source["name"]);
  return {
    object: "customer",
    source: "zid",
    id: str(source["id"]) ?? str(source["customer_id"]),
    first_name: str(source["first_name"]) ?? (name ? (name.split(" ")[0] ?? name) : null),
    last_name: str(source["last_name"]) ?? (name && name.includes(" ") ? name.split(" ").slice(1).join(" ") : null),
    email: str(source["email"]),
    phone: mobile ? `${code && !mobile.startsWith("+") ? code : ""}${mobile}` : null,
    city: localized(source["city"]),
    country: localized(source["country"]),
  };
}

export function normalizeZidProduct(input: unknown): NormalizedZidProduct {
  const source = record(input);
  return {
    object: "product",
    source: "zid",
    id: str(source["id"]) ?? str(source["product_id"]),
    name: localized(source["name"]),
    sku: str(source["sku"]),
    status: str(source["is_published"] === false ? "hidden" : source["status"]) ?? (source["is_published"] ? "published" : null),
    price: amount(source["price"], source["currency"]),
    quantity: num(source["quantity"]),
    unlimited_quantity: source["is_infinite"] === true || source["unlimited_quantity"] === true,
    url: str(source["url"]) ?? str(record(source["urls"])["customer"]),
  };
}

export function normalizeZidOrder(input: unknown): NormalizedZidOrder {
  const source = record(input);
  const shipping = record(source["shipping"]);
  const shippingMethod = record(shipping["method"] ?? source["shipping_method"]);
  const address = record(
    shipping["address"] ?? source["shipping_address"] ?? record(source["customer"])["address"],
  );
  const products = Array.isArray(source["products"])
    ? (source["products"] as unknown[])
    : Array.isArray(source["items"])
      ? (source["items"] as unknown[])
      : [];
  const currency = source["currency_code"] ?? source["currency"];

  return {
    object: "order",
    source: "zid",
    id: str(source["id"]) ?? str(source["order_id"]),
    reference: str(source["code"]) ?? str(source["reference_id"]) ?? str(source["order_number"]),
    status: localized(record(source["order_status"])["name"] ?? source["order_status"] ?? source["status"]),
    payment_method: str(source["payment_method"]) ?? localized(record(source["payment"])["method"]),
    placed_at: str(source["created_at"]) ?? str(source["issue_date"]),
    total: amount(source["order_total"] ?? record(source["totals"])["total"] ?? source["total"], currency),
    customer: normalizeZidCustomer(source["customer"]),
    shipping: {
      method: localized(shippingMethod["name"] ?? shippingMethod["code"] ?? shipping["company"]),
      tracking_number: str(shipping["tracking_number"]) ?? str(record(shipping["waybill"])["number"]),
      address:
        Object.keys(address).length === 0
          ? null
          : {
              country: localized(address["country"]),
              city: localized(address["city"]),
              street: str(address["street"]) ?? str(address["formatted_address"]),
              postal_code: str(address["postal_code"]),
            },
    },
    items: products.map((item) => {
      const line = record(item);
      return {
        id: str(line["id"]),
        product_id: str(line["product_id"]) ?? str(record(line["product"])["id"]),
        name: localized(line["name"]) ?? localized(record(line["product"])["name"]),
        sku: str(line["sku"]),
        quantity: num(line["quantity"]),
        price: amount(line["price"] ?? line["net_sale_price"], currency),
      };
    }),
    store_id: str(record(source["store"])["id"]) ?? str(source["store_id"]),
    raw_id: str(source["id"]) ?? str(source["order_id"]),
  };
}

/**
 * Normalizes a Zid webhook payload. Zid posts the resource itself and names the
 * event through the `X-Zid-Event`/`event` field, so the family is derived from
 * whichever of the two the ingress captured.
 */
export function normalizeZidWebhookEvent(
  payload: unknown,
  eventType?: string | null,
): {
  event: string | null;
  store_id: string | null;
  created_at: string | null;
  resource: Record<string, unknown>;
  normalized: NormalizedZidOrder | NormalizedZidProduct | NormalizedZidCustomer | null;
} {
  const body = record(payload);
  const event = str(eventType) ?? str(body["event"]) ?? str(body["event_type"]);
  const data = Object.keys(record(body["data"])).length > 0 ? record(body["data"]) : body;
  const family = event?.split(/[.\-_]/)[0] ?? "";
  const normalized =
    family === "order"
      ? normalizeZidOrder(data)
      : family === "product"
        ? normalizeZidProduct(data)
        : family === "customer"
          ? normalizeZidCustomer(data)
          : null;

  return {
    event,
    store_id: str(record(data["store"])["id"]) ?? str(body["store_id"]) ?? str(record(body["store"])["id"]),
    created_at: str(data["created_at"]) ?? str(body["created_at"]),
    resource: data,
    normalized,
  };
}
