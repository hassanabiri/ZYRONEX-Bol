/**
 * Salla → ZYRONEX normalization.
 *
 * Pure mapping only. No business logic, no AI, no decisions — the connector
 * layer's single job here is to turn Salla's payload shapes into the neutral
 * shapes the rest of ZYRONEX (workflows, CRM, agents) already understands.
 */

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function str(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function amount(value: unknown): { amount: number | null; currency: string | null } {
  const source = record(value);
  const raw = source["amount"] ?? source["value"] ?? value;
  const num = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  return {
    amount: Number.isFinite(num) ? num : null,
    currency: str(source["currency"]) ?? null,
  };
}

export type NormalizedOrder = {
  object: "order";
  source: "salla";
  id: string | null;
  reference: string | null;
  status: string | null;
  payment_method: string | null;
  placed_at: string | null;
  total: { amount: number | null; currency: string | null };
  customer: NormalizedCustomer | null;
  shipping: {
    method: string | null;
    tracking_number: string | null;
    address: {
      country: string | null;
      city: string | null;
      street: string | null;
      postal_code: string | null;
    } | null;
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

export type NormalizedCustomer = {
  object: "customer";
  source: "salla";
  id: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  country: string | null;
};

export type NormalizedProduct = {
  object: "product";
  source: "salla";
  id: string | null;
  name: string | null;
  sku: string | null;
  status: string | null;
  price: { amount: number | null; currency: string | null };
  quantity: number | null;
  unlimited_quantity: boolean;
  url: string | null;
};

export function normalizeCustomer(input: unknown): NormalizedCustomer | null {
  const source = record(input);
  if (Object.keys(source).length === 0) return null;
  const mobile = str(source["mobile"]);
  const code = str(source["mobile_code"]);
  return {
    object: "customer",
    source: "salla",
    id: str(source["id"]),
    first_name: str(source["first_name"]) ?? str(source["name"]),
    last_name: str(source["last_name"]),
    email: str(source["email"]),
    phone: mobile ? `${code ?? ""}${mobile}` : null,
    city: str(record(source["city"])["name"]) ?? str(source["city"]),
    country: str(record(source["country"])["name"]) ?? str(source["country"]),
  };
}

export function normalizeProduct(input: unknown): NormalizedProduct {
  const source = record(input);
  return {
    object: "product",
    source: "salla",
    id: str(source["id"]),
    name: str(source["name"]),
    sku: str(source["sku"]),
    status: str(source["status"]),
    price: amount(source["price"]),
    quantity: typeof source["quantity"] === "number" ? (source["quantity"] as number) : null,
    unlimited_quantity: Boolean(source["unlimited_quantity"]),
    url: str(source["urls"] ? record(source["urls"])["customer"] : source["url"]),
  };
}

export function normalizeOrder(input: unknown): NormalizedOrder {
  const source = record(input);
  const shipping = record(source["shipping"]);
  const shipmentAddress = record(shipping["address"] ?? record(source["receiver"])["address"]);
  const items = Array.isArray(source["items"]) ? (source["items"] as unknown[]) : [];

  return {
    object: "order",
    source: "salla",
    id: str(source["id"]),
    reference: str(source["reference_id"]) ?? str(source["reference"]),
    status: str(record(source["status"])["name"]) ?? str(source["status"]),
    payment_method: str(source["payment_method"]),
    placed_at: str(record(source["date"])["date"]) ?? str(source["date"]) ?? str(source["created_at"]),
    total: amount(record(source["amounts"])["total"] ?? source["total"]),
    customer: normalizeCustomer(source["customer"]),
    shipping: {
      method: str(shipping["company"]) ?? str(shipping["method"]),
      tracking_number: str(shipping["shipment_number"]) ?? str(shipping["tracking_number"]),
      address:
        Object.keys(shipmentAddress).length === 0
          ? null
          : {
              country: str(shipmentAddress["country"]),
              city: str(shipmentAddress["city"]),
              street: str(shipmentAddress["street_number"]) ?? str(shipmentAddress["shipping_address"]),
              postal_code: str(shipmentAddress["postal_code"]),
            },
    },
    items: items.map((item) => {
      const line = record(item);
      return {
        id: str(line["id"]),
        product_id: str(record(line["product"])["id"]) ?? str(line["product_id"]),
        name: str(line["name"]) ?? str(record(line["product"])["name"]),
        sku: str(line["sku"]),
        quantity: typeof line["quantity"] === "number" ? (line["quantity"] as number) : null,
        price: amount(line["amounts"] ? record(record(line["amounts"])["price_without_tax"]) : line["price"]),
      };
    }),
    store_id: str(record(source["store"])["id"]) ?? str(source["store_id"]),
    raw_id: str(source["id"]),
  };
}

/** Normalizes a Salla webhook envelope `{ event, merchant, data }`. */
export function normalizeWebhookEvent(payload: unknown): {
  event: string | null;
  merchant_id: string | null;
  created_at: string | null;
  resource: Record<string, unknown>;
  normalized: NormalizedOrder | NormalizedProduct | NormalizedCustomer | null;
} {
  const body = record(payload);
  const event = str(body["event"]);
  const data = record(body["data"]);
  const family = event?.split(".")[0] ?? "";
  const normalized =
    family === "order"
      ? normalizeOrder(data)
      : family === "product"
        ? normalizeProduct(data)
        : family === "customer"
          ? normalizeCustomer(data)
          : null;
  return {
    event,
    merchant_id: str(body["merchant"]),
    created_at: str(body["created_at"]),
    resource: data,
    normalized,
  };
}
