/**
 * Shopify → ZYRONEX normalization.
 *
 * Pure mapping only. No business logic, no AI, no decisions — the connector
 * layer turns Shopify's payload shapes into the same neutral shapes the rest of
 * ZYRONEX (workflows, CRM, agents) already consumes for Salla and Zid.
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

/** Shopify money is a decimal string, with the currency reported next to it. */
function amount(value: unknown, currency: unknown): { amount: number | null; currency: string | null } {
  const source = record(value);
  const raw = source["amount"] ?? value;
  return { amount: num(raw), currency: str(source["currency_code"]) ?? str(currency) };
}

export type NormalizedShopifyCustomer = {
  object: "customer";
  source: "shopify";
  id: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  country: string | null;
  orders_count: number | null;
  state: string | null;
};

export type NormalizedShopifyProduct = {
  object: "product";
  source: "shopify";
  id: string | null;
  name: string | null;
  handle: string | null;
  status: string | null;
  vendor: string | null;
  product_type: string | null;
  price: { amount: number | null; currency: string | null };
  quantity: number | null;
  variants: {
    id: string | null;
    sku: string | null;
    title: string | null;
    price: { amount: number | null; currency: string | null };
    quantity: number | null;
    inventory_item_id: string | null;
  }[];
  updated_at: string | null;
};

export type NormalizedShopifyOrder = {
  object: "order";
  source: "shopify";
  id: string | null;
  reference: string | null;
  status: string | null;
  financial_status: string | null;
  fulfillment_status: string | null;
  payment_method: string | null;
  placed_at: string | null;
  total: { amount: number | null; currency: string | null };
  customer: NormalizedShopifyCustomer | null;
  shipping: {
    method: string | null;
    tracking_number: string | null;
    address: { country: string | null; city: string | null; street: string | null; postal_code: string | null } | null;
  };
  items: {
    id: string | null;
    product_id: string | null;
    variant_id: string | null;
    name: string | null;
    sku: string | null;
    quantity: number | null;
    price: { amount: number | null; currency: string | null };
  }[];
  raw_id: string | null;
};

export type NormalizedShopifyInventoryLevel = {
  object: "inventory_level";
  source: "shopify";
  inventory_item_id: string | null;
  location_id: string | null;
  available: number | null;
  updated_at: string | null;
};

export function normalizeShopifyCustomer(input: unknown): NormalizedShopifyCustomer | null {
  const source = record(input);
  if (Object.keys(source).length === 0) return null;
  const address = record(source["default_address"]);
  return {
    object: "customer",
    source: "shopify",
    id: str(source["id"]),
    first_name: str(source["first_name"]) ?? str(address["first_name"]),
    last_name: str(source["last_name"]) ?? str(address["last_name"]),
    email: str(source["email"]),
    phone: str(source["phone"]) ?? str(address["phone"]),
    city: str(address["city"]),
    country: str(address["country"]) ?? str(address["country_code"]),
    orders_count: num(source["orders_count"]),
    state: str(source["state"]),
  };
}

export function normalizeShopifyProduct(input: unknown): NormalizedShopifyProduct {
  const source = record(input);
  const variants = Array.isArray(source["variants"]) ? (source["variants"] as unknown[]) : [];
  const currency = source["currency"] ?? null;
  const mapped = variants.map((entry) => {
    const variant = record(entry);
    return {
      id: str(variant["id"]),
      sku: str(variant["sku"]),
      title: str(variant["title"]),
      price: amount(variant["price"], currency),
      quantity: num(variant["inventory_quantity"]),
      inventory_item_id: str(variant["inventory_item_id"]),
    };
  });

  const totalQuantity = mapped.reduce<number | null>(
    (acc, variant) => (variant.quantity === null ? acc : (acc ?? 0) + variant.quantity),
    null,
  );

  return {
    object: "product",
    source: "shopify",
    id: str(source["id"]),
    name: str(source["title"]),
    handle: str(source["handle"]),
    status: str(source["status"]) ?? (source["published_at"] ? "active" : null),
    vendor: str(source["vendor"]),
    product_type: str(source["product_type"]),
    price: mapped[0]?.price ?? amount(source["price"], currency),
    quantity: totalQuantity,
    variants: mapped,
    updated_at: str(source["updated_at"]),
  };
}

export function normalizeShopifyOrder(input: unknown): NormalizedShopifyOrder {
  const source = record(input);
  const currency = source["currency"] ?? source["presentment_currency"];
  const shippingLine = record(Array.isArray(source["shipping_lines"]) ? source["shipping_lines"][0] : undefined);
  const address = record(source["shipping_address"] ?? source["billing_address"]);
  const fulfillment = record(Array.isArray(source["fulfillments"]) ? source["fulfillments"][0] : undefined);
  const lines = Array.isArray(source["line_items"]) ? (source["line_items"] as unknown[]) : [];
  const gateways = Array.isArray(source["payment_gateway_names"])
    ? (source["payment_gateway_names"] as unknown[]).map((value) => str(value)).filter(Boolean)
    : [];

  return {
    object: "order",
    source: "shopify",
    id: str(source["id"]),
    reference: str(source["name"]) ?? str(source["order_number"]),
    status: source["cancelled_at"] ? "cancelled" : source["closed_at"] ? "closed" : "open",
    financial_status: str(source["financial_status"]),
    fulfillment_status: str(source["fulfillment_status"]),
    payment_method: str(source["gateway"]) ?? (gateways.length ? (gateways[0] as string) : null),
    placed_at: str(source["created_at"]) ?? str(source["processed_at"]),
    total: amount(source["total_price"] ?? source["current_total_price"], currency),
    customer: normalizeShopifyCustomer(source["customer"]),
    shipping: {
      method: str(shippingLine["title"]) ?? str(shippingLine["code"]),
      tracking_number: str(fulfillment["tracking_number"]),
      address:
        Object.keys(address).length === 0
          ? null
          : {
              country: str(address["country"]) ?? str(address["country_code"]),
              city: str(address["city"]),
              street: [str(address["address1"]), str(address["address2"])].filter(Boolean).join(" ") || null,
              postal_code: str(address["zip"]),
            },
    },
    items: lines.map((entry) => {
      const line = record(entry);
      return {
        id: str(line["id"]),
        product_id: str(line["product_id"]),
        variant_id: str(line["variant_id"]),
        name: str(line["title"]) ?? str(line["name"]),
        sku: str(line["sku"]),
        quantity: num(line["quantity"]),
        price: amount(line["price"], currency),
      };
    }),
    raw_id: str(source["id"]),
  };
}

export function normalizeShopifyInventoryLevel(input: unknown): NormalizedShopifyInventoryLevel {
  const source = record(input);
  return {
    object: "inventory_level",
    source: "shopify",
    inventory_item_id: str(source["inventory_item_id"]),
    location_id: str(source["location_id"]),
    available: num(source["available"]),
    updated_at: str(source["updated_at"]),
  };
}

/**
 * Normalizes a Shopify webhook payload. Shopify posts the resource itself and
 * names the event through the `X-Shopify-Topic` header (e.g. `orders/updated`),
 * so the family is derived from the topic the ingress captured.
 */
export function normalizeShopifyWebhookEvent(
  payload: unknown,
  topic?: string | null,
): {
  event: string | null;
  shop_domain: string | null;
  created_at: string | null;
  resource: Record<string, unknown>;
  normalized:
    | NormalizedShopifyOrder
    | NormalizedShopifyProduct
    | NormalizedShopifyCustomer
    | NormalizedShopifyInventoryLevel
    | null;
} {
  const data = record(payload);
  const event = str(topic) ?? str(data["topic"]);
  const family = event?.split("/")[0] ?? "";
  const normalized =
    family === "orders" || family === "order"
      ? normalizeShopifyOrder(data)
      : family === "products" || family === "product"
        ? normalizeShopifyProduct(data)
        : family === "customers" || family === "customer"
          ? normalizeShopifyCustomer(data)
          : family === "inventory_levels"
            ? normalizeShopifyInventoryLevel(data)
            : null;

  return {
    event,
    shop_domain: str(data["shop_domain"]) ?? str(record(data["shop"])["domain"]),
    created_at: str(data["created_at"]) ?? str(data["updated_at"]),
    resource: data,
    normalized,
  };
}
