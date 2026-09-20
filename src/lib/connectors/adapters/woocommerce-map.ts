/**
 * WooCommerce → ZYRONEX normalization.
 *
 * Pure mapping only. No business logic, no AI, no decisions — the connector
 * layer turns WooCommerce's payload shapes into the same neutral shapes the rest
 * of ZYRONEX (workflows, CRM, agents) already consumes for Salla, Zid and
 * Shopify.
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

/** WooCommerce money is a decimal string; currency is reported per order. */
function amount(value: unknown, currency: unknown): { amount: number | null; currency: string | null } {
  return { amount: num(value), currency: str(currency) };
}

export type NormalizedWooCustomer = {
  object: "customer";
  source: "woocommerce";
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

export type NormalizedWooProduct = {
  object: "product";
  source: "woocommerce";
  id: string | null;
  name: string | null;
  sku: string | null;
  slug: string | null;
  status: string | null;
  type: string | null;
  price: { amount: number | null; currency: string | null };
  regular_price: { amount: number | null; currency: string | null };
  quantity: number | null;
  manage_stock: boolean;
  stock_status: string | null;
  categories: string[];
  updated_at: string | null;
};

export type NormalizedWooOrder = {
  object: "order";
  source: "woocommerce";
  id: string | null;
  reference: string | null;
  status: string | null;
  financial_status: string | null;
  payment_method: string | null;
  placed_at: string | null;
  total: { amount: number | null; currency: string | null };
  customer: NormalizedWooCustomer | null;
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

export type NormalizedWooInventoryLevel = {
  object: "inventory_level";
  source: "woocommerce";
  product_id: string | null;
  variation_id: string | null;
  sku: string | null;
  available: number | null;
  stock_status: string | null;
  manage_stock: boolean;
  updated_at: string | null;
};

/** WooCommerce order status doubles as its payment lifecycle state. */
const PAID_STATUSES = new Set(["processing", "completed", "refunded"]);

function personFrom(billing: Record<string, unknown>, shipping: Record<string, unknown>) {
  return {
    first_name: str(billing["first_name"]) ?? str(shipping["first_name"]),
    last_name: str(billing["last_name"]) ?? str(shipping["last_name"]),
    email: str(billing["email"]),
    phone: str(billing["phone"]),
    city: str(billing["city"]) ?? str(shipping["city"]),
    country: str(billing["country"]) ?? str(shipping["country"]),
  };
}

export function normalizeWooCustomer(input: unknown): NormalizedWooCustomer | null {
  const source = record(input);
  if (Object.keys(source).length === 0) return null;
  const billing = record(source["billing"]);
  const shipping = record(source["shipping"]);
  const person = personFrom(billing, shipping);
  return {
    object: "customer",
    source: "woocommerce",
    id: str(source["id"]),
    first_name: str(source["first_name"]) ?? person.first_name,
    last_name: str(source["last_name"]) ?? person.last_name,
    email: str(source["email"]) ?? person.email,
    phone: person.phone,
    city: person.city,
    country: person.country,
    orders_count: num(source["orders_count"]),
    state: str(source["role"]),
  };
}

export function normalizeWooProduct(input: unknown): NormalizedWooProduct {
  const source = record(input);
  const categories = Array.isArray(source["categories"])
    ? (source["categories"] as unknown[]).map((entry) => str(record(entry)["name"])).filter((n): n is string => Boolean(n))
    : [];

  return {
    object: "product",
    source: "woocommerce",
    id: str(source["id"]),
    name: str(source["name"]),
    sku: str(source["sku"]),
    slug: str(source["slug"]),
    status: str(source["status"]),
    type: str(source["type"]),
    price: amount(source["price"], null),
    regular_price: amount(source["regular_price"], null),
    quantity: num(source["stock_quantity"]),
    manage_stock: source["manage_stock"] === true,
    stock_status: str(source["stock_status"]),
    categories,
    updated_at: str(source["date_modified_gmt"]) ?? str(source["date_modified"]),
  };
}

export function normalizeWooOrder(input: unknown): NormalizedWooOrder {
  const source = record(input);
  const currency = source["currency"];
  const billing = record(source["billing"]);
  const shipping = record(source["shipping"]);
  const lines = Array.isArray(source["line_items"]) ? (source["line_items"] as unknown[]) : [];
  const shippingLines = Array.isArray(source["shipping_lines"]) ? (source["shipping_lines"] as unknown[]) : [];
  const status = str(source["status"]);
  const hasAddress = Object.keys(shipping).length > 0 || Object.keys(billing).length > 0;
  const address = Object.keys(shipping).length > 0 ? shipping : billing;

  const customer = normalizeWooCustomer({
    id: source["customer_id"],
    billing,
    shipping,
  });

  return {
    object: "order",
    source: "woocommerce",
    id: str(source["id"]),
    reference: str(source["number"]) ?? str(source["id"]),
    status,
    financial_status: source["date_paid"] || (status && PAID_STATUSES.has(status)) ? "paid" : "unpaid",
    payment_method: str(source["payment_method_title"]) ?? str(source["payment_method"]),
    placed_at: str(source["date_created_gmt"]) ?? str(source["date_created"]),
    total: amount(source["total"], currency),
    customer,
    shipping: {
      method: str(record(shippingLines[0])["method_title"]) ?? str(record(shippingLines[0])["method_id"]),
      tracking_number: null,
      address: hasAddress
        ? {
            country: str(address["country"]),
            city: str(address["city"]),
            street: [str(address["address_1"]), str(address["address_2"])].filter(Boolean).join(" ") || null,
            postal_code: str(address["postcode"]),
          }
        : null,
    },
    items: lines.map((entry) => {
      const line = record(entry);
      return {
        id: str(line["id"]),
        product_id: str(line["product_id"]),
        variant_id: str(line["variation_id"]),
        name: str(line["name"]),
        sku: str(line["sku"]),
        quantity: num(line["quantity"]),
        price: amount(line["price"], currency),
      };
    }),
    raw_id: str(source["id"]),
  };
}

/**
 * WooCommerce has no dedicated inventory resource: stock lives on the product
 * (and on variations), so a level is projected from that same payload.
 */
export function normalizeWooInventoryLevel(input: unknown): NormalizedWooInventoryLevel {
  const source = record(input);
  const isVariation = source["parent_id"] !== undefined && num(source["parent_id"]) !== 0;
  return {
    object: "inventory_level",
    source: "woocommerce",
    product_id: isVariation ? str(source["parent_id"]) : str(source["id"]),
    variation_id: isVariation ? str(source["id"]) : null,
    sku: str(source["sku"]),
    available: num(source["stock_quantity"]),
    stock_status: str(source["stock_status"]),
    manage_stock: source["manage_stock"] === true,
    updated_at: str(source["date_modified_gmt"]) ?? str(source["date_modified"]),
  };
}

/**
 * Normalizes a WooCommerce webhook delivery. WooCommerce posts the resource
 * itself and names the event through `X-WC-Webhook-Topic` (e.g. `order.updated`),
 * so the family comes from the topic the ingress captured.
 */
export function normalizeWooWebhookEvent(
  payload: unknown,
  topic?: string | null,
): {
  event: string | null;
  resource: Record<string, unknown>;
  created_at: string | null;
  normalized: NormalizedWooOrder | NormalizedWooProduct | NormalizedWooCustomer | null;
} {
  const data = record(payload);
  const event = str(topic);
  const family = event?.split(".")[0] ?? "";
  const normalized =
    family === "order"
      ? normalizeWooOrder(data)
      : family === "product"
        ? normalizeWooProduct(data)
        : family === "customer"
          ? normalizeWooCustomer(data)
          : null;

  return {
    event,
    resource: data,
    created_at: str(data["date_modified_gmt"]) ?? str(data["date_created_gmt"]) ?? str(data["date_created"]),
    normalized,
  };
}
